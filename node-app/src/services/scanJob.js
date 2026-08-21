const jobStore = require("./jobStore");
const googleAuth = require("./googleAuth");
const gmailClient = require("./gmailClient");
const excelTracker = require("./excelTracker");
const dedup = require("./dedup");
const invoicePipeline = require("./invoicePipeline");
const tokenStore = require("./tokenStore");
const { MAX_SCAN_LIMIT } = require("../config");

// Single-scan-at-a-time lock. Reconciled against disk at boot by
// jobStore.reconcileOrphanedJobs() (called from server.js) - if the
// process restarts mid-scan, the orphaned job file gets marked as errored
// on the next boot, which is what actually releases a *stale* lock. This
// in-memory flag only guards concurrent scans within one process lifetime.
let activeJobId = null;

// Cancellation flag lives in-memory, not on the job's disk file - the
// running job's own `job` variable is a separate in-memory object from
// whatever a cancel request reads/writes, and it re-saves its own state
// every iteration, so a disk-only flag would just get clobbered on the
// next write. A shared in-process flag avoids that race entirely, and
// works fine since the whole point of this architecture is one process
// running the job in-process.
const cancelFlags = new Set();

function isRunning() {
  return activeJobId !== null;
}

function getActiveJobId() {
  return activeJobId;
}

function requestCancel(jobId) {
  cancelFlags.add(jobId);
}

// Runs the whole scan as a background task, independent of any HTTP
// request - this is the actual fix for the "scan times out mid-request"
// problem, regardless of host. Never awaited by the route that starts it.
async function run(jobId, params) {
  activeJobId = jobId;
  let job = jobStore.readJob(jobId);

  try {
    job.status = "running";
    job = jobStore.writeJob(job);

    const activeEmail = tokenStore.getActiveAccount();
    if (!activeEmail) {
      job = jobStore.markError(job, "No Google account connected. Connect one first.", "reconnect_required");
      return;
    }

    job = jobStore.appendLog(job, "🔌 Connecting to Gmail...");
    let gmail;
    try {
      ({ gmail } = await googleAuth.clientForAccount(activeEmail));
    } catch (err) {
      if (err instanceof googleAuth.ReconnectRequiredError) {
        job = jobStore.markError(
          job,
          "Google account access was revoked. Reconnect your Google account to continue scanning.",
          "reconnect_required"
        );
        return;
      }
      throw err;
    }

    const limit = Math.min(params.limit || 20, MAX_SCAN_LIMIT);
    job = jobStore.appendLog(
      job,
      `Search: from="${params.senderFilter || "(any)"}" after=${params.dateFrom || "(any)"} limit=${limit}`
    );

    const ids = await gmailClient.searchMessageIds(gmail, {
      senderFilter: params.senderFilter,
      dateFrom: params.dateFrom,
      limit,
    });
    job = jobStore.appendLog(job, `Emails matching search: ${ids.length}`);

    const processed = dedup.loadProcessedIds();
    const { wb, ws } = await excelTracker.getOrCreateWorkbook();
    const index = dedup.buildIndex(ws);
    let nextRow = excelTracker.lastDataRow(ws) + 1;

    const summary = [];
    const newlyProcessed = new Set();
    let skippedProcessedCount = 0;
    const total = ids.length;

    for (let i = 0; i < ids.length; i++) {
      if (cancelFlags.has(jobId)) {
        job = jobStore.appendLog(job, "⏹️ Cancelled — anything logged so far is already saved in the tracker.");
        job = jobStore.markCancelled(job);
        return;
      }

      const id = ids[i];
      job = jobStore.setProgress(job, i + 1, total, `Checking email ${i + 1}/${total}...`);

      if (processed.has(id)) {
        skippedProcessedCount++;
        job.counts.alreadyProcessed++;
        continue;
      }

      let msg;
      try {
        msg = await gmailClient.getMessage(gmail, id);
      } catch (err) {
        job.counts.errors++;
        job = jobStore.appendLog(job, `❌ Could not fetch message ${id}: ${err.message}`);
        continue;
      }

      if (!msg.pdfParts.length) {
        job = jobStore.appendLog(job, `⬜ ${msg.subject.slice(0, 50)} — no PDF attachments`);
        continue; // not marked processed - re-checked next scan, same as the original app
      }

      job = jobStore.appendLog(
        job,
        `✅ From: ${msg.from.slice(0, 40)} | ${msg.subject.slice(0, 40)} | PDFs: [${msg.pdfParts
          .map((p) => p.filename)
          .join(", ")}]`
      );

      for (const part of msg.pdfParts) {
        job = jobStore.setProgress(job, i + 1, total, `📄 Reading ${part.filename}...`);

        let buffer;
        try {
          buffer = await gmailClient.getAttachmentBytes(gmail, id, part.attachmentId);
        } catch (err) {
          summary.push({ email: msg.subject, file: part.filename, status: "error", reason: err.message });
          job.counts.errors++;
          job = jobStore.appendLog(job, `❌ ${part.filename} — could not download: ${err.message}`);
          continue;
        }

        job = jobStore.setProgress(job, i + 1, total, `🤖 Extracting ${part.filename}...`);

        let outcome;
        try {
          outcome = await invoicePipeline.extractAndAppend(buffer, { wb, ws, index, nextRow });
        } catch (err) {
          summary.push({ email: msg.subject, file: part.filename, status: "error", reason: err.message });
          job.counts.errors++;
          job = jobStore.appendLog(job, `❌ ${part.filename} — ${err.message}`);
          continue;
        }

        nextRow = outcome.nextRow;

        for (const s of outcome.skipped) {
          summary.push({ email: msg.subject, file: part.filename, status: "skipped", reason: s.reason });
          job.counts.skippedDuplicate++;
          job = jobStore.appendLog(job, `⏭️ ${s.vendor || "Unknown"} — ${s.reason}`);
        }

        for (const rec of outcome.logged) {
          summary.push({
            email: msg.subject,
            file: part.filename,
            status: "ok",
            sn: rec.sn,
            vendor: rec.vendor,
            period: rec.period,
            budget_holder: rec.budget_holder,
            audit: rec.audit,
            rejection: rec.rejection,
          });
          job.counts.logged++;
          job = jobStore.appendLog(job, `✅ Logged ${rec.vendor || "Unknown vendor"} (${rec.sn})`);
        }
      }

      newlyProcessed.add(id);
    }

    if (skippedProcessedCount) {
      job = jobStore.appendLog(job, `ℹ️ Skipped ${skippedProcessedCount} already-processed emails`);
    }

    for (const id of newlyProcessed) processed.add(id);
    dedup.saveProcessedIds(processed);

    const ok = summary.filter((s) => s.status === "ok");
    const skipped = summary.filter((s) => s.status !== "ok");
    job = jobStore.markDone(job, { processed: ok, skipped, total: summary.length });
  } catch (err) {
    job = jobStore.markError(job, err.message);
  } finally {
    activeJobId = null;
    cancelFlags.delete(jobId);
  }
}

module.exports = { run, isRunning, getActiveJobId, requestCancel };
