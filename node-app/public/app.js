function setLoading(btnId, spId, lblId, on) {
  document.getElementById(btnId).disabled = on;
  if (spId) document.getElementById(spId).style.display = on ? "inline" : "none";
  if (lblId) document.getElementById(lblId).style.display = on ? "none" : "inline";
}

function tc(t) {
  if (!t) return "tag-p";
  if (t.includes("APPROVED")) return "tag-a";
  if (t.includes("REJECTED")) return "tag-r";
  return "tag-p";
}
function ti(t) {
  if (!t) return "⏳";
  if (t.includes("APPROVED")) return "✅";
  if (t.includes("REJECTED")) return "❌";
  return "⏳";
}

async function refreshStats() {
  try {
    const r = await fetch("/stats");
    const j = await r.json();
    const el = document.getElementById("statTracked");
    if (el) el.textContent = j.rowCount;
  } catch (_) {}
}

// ── Google account connection ───────────────────────────────────────────
async function refreshAccountStatus() {
  const row = document.getElementById("accountRow");
  const status = document.getElementById("accountStatus");
  const action = document.getElementById("accountAction");
  const formWrap = document.getElementById("scanFormWrap");
  try {
    const r = await fetch("/auth/google/status");
    const j = await r.json();
    if (j.connected) {
      row.classList.remove("disconnected");
      status.textContent = `Connected as ${j.email}`;
      action.textContent = "Disconnect";
      action.href = "#";
      action.onclick = async (e) => {
        e.preventDefault();
        await fetch("/auth/google/disconnect", { method: "POST" });
        refreshAccountStatus();
      };
      formWrap.style.display = "block";
    } else {
      row.classList.add("disconnected");
      status.textContent = "Not connected";
      action.textContent = "Connect Google Account";
      action.href = "/auth/google";
      action.onclick = null;
      formWrap.style.display = "none";
    }
  } catch (_) {
    status.textContent = "Could not check connection status.";
  }
}

// ── Scan (background job + polling) ─────────────────────────────────────
let pollTimer = null;
const seenLogLines = new Set();

function renderScanState(job) {
  const box = document.getElementById("scanResult");
  box.style.display = "block";

  if (job.status === "starting" || job.status === "running") {
    let html = `<div style="font-weight:700;margin-bottom:6px;color:#1F4E79">⏳ ${job.progress.message || "Working..."}</div>`;
    html += `<details class="debug-box" open><summary>🔍 Live progress</summary><div style="margin-top:6px;max-height:240px;overflow-y:auto">`;
    html += job.log.map((l) => `<div>${l}</div>`).join("");
    html += `</div></details>`;
    box.innerHTML = html;
    return;
  }

  if (job.status === "error") {
    let html = `<div class="r-item r-err">❌ ${job.error ? job.error.message : "Scan failed."}</div>`;
    if (job.errorType === "reconnect_required") {
      html += `<a href="/auth/google" class="secondary" style="display:inline-block;margin-top:8px;text-decoration:none;padding:8px 14px;border:1px solid #1F4E79;border-radius:6px;color:#1F4E79;font-size:0.85rem">Reconnect Google Account</a>`;
    }
    box.innerHTML = html;
    stopPolling();
    refreshStats();
    return;
  }

  if (job.status === "cancelled") {
    box.innerHTML = `<div class="r-item r-err">⏹️ Scan cancelled. Anything logged before cancelling is already saved.</div>`;
    stopPolling();
    refreshStats();
    return;
  }

  if (job.status === "done") {
    const ok = (job.result && job.result.processed) || [];
    const skip = (job.result && job.result.skipped) || [];
    let html = `<div style="font-weight:700;margin-bottom:10px;color:#276749">✅ ${ok.length} invoice${ok.length !== 1 ? "s" : ""} extracted | ⚠️ ${skip.length} skipped</div>`;
    if (job.log.length) {
      html += `<details class="debug-box"><summary>🔍 What the app saw (tap to expand)</summary><div style="margin-top:6px">${job.log.map((d) => `<div>${d}</div>`).join("")}</div></details>`;
    }
    ok.forEach((p) => {
      html += `<div class="r-item r-ok"><strong>${p.vendor || "Unknown"}</strong>${p.period ? ` — ${p.period}` : ""}
        <div class="approvals">
          <span class="tag ${tc(p.budget_holder)}">${ti(p.budget_holder)} BH: ${p.budget_holder || "Pending"}</span>
          <span class="tag ${tc(p.audit)}">${ti(p.audit)} Audit: ${p.audit || "Pending"}</span>
        </div>${p.rejection ? `<div style="margin-top:4px;color:#9c0006;font-size:.76rem">⛔ ${p.rejection}</div>` : ""}</div>`;
    });
    skip.forEach((p) => {
      html += `<div class="r-item r-err"><strong>⚠️ ${p.file || p.email || "Skipped"}</strong><br><span style="font-size:.78rem">${p.reason}</span></div>`;
    });
    box.innerHTML = html;
    stopPolling();
    refreshStats();
  }
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  setLoading("scanBtn", "scanSpinner", "scanLabel", false);
  sessionStorage.removeItem("inda_job_id");
}

async function pollJob(jobId) {
  try {
    const r = await fetch(`/scan/${jobId}`);
    if (r.status === 404) {
      document.getElementById("scanResult").innerHTML =
        `<div class="r-item r-err">Connection to the running scan was lost, but everything logged so far is safely in the tracker. Reload to see the current count.</div>`;
      stopPolling();
      return;
    }
    const job = await r.json();
    renderScanState(job);
    if (job.status === "starting" || job.status === "running") {
      pollTimer = setTimeout(() => pollJob(jobId), 2500);
    }
  } catch (_) {
    pollTimer = setTimeout(() => pollJob(jobId), 2500);
  }
}

async function startScan() {
  const senderFilter = document.getElementById("snd").value.trim();
  const dateFrom = document.getElementById("dtf").value;
  let limit = parseInt(document.getElementById("lim").value, 10) || 20;
  if (limit > 500) {
    document.getElementById("lim").value = 500;
    limit = 500;
  }

  setLoading("scanBtn", "scanSpinner", "scanLabel", true);
  const box = document.getElementById("scanResult");
  box.style.display = "block";
  box.innerHTML = `<div style="font-weight:700;color:#1F4E79">⏳ Starting...</div>`;

  try {
    const resp = await fetch("/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderFilter, dateFrom, limit }),
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || `Server error (HTTP ${resp.status})`);

    sessionStorage.setItem("inda_job_id", j.jobId);
    pollJob(j.jobId);
  } catch (e) {
    box.innerHTML = `<div class="r-item r-err">❌ ${e.message}</div>`;
    setLoading("scanBtn", "scanSpinner", "scanLabel", false);
  }
}

// ── Manual PDF upload ────────────────────────────────────────────────────
let selFile = null;
function setFile(f) {
  if (!f || !f.name.toLowerCase().endsWith(".pdf")) return;
  selFile = f;
  document.getElementById("dzText").innerHTML = `${f.name}<br><span style="font-size:0.75rem">${Math.round(f.size / 1024)} KB</span>`;
  document.getElementById("upBtn").disabled = false;
}

async function uploadFile() {
  if (!selFile) return;
  setLoading("upBtn", null, null, true);
  const box = document.getElementById("upResult");
  box.style.display = "block";
  box.innerHTML = `<div style="color:#1F4E79">⏳ Extracting...</div>`;

  try {
    const fd = new FormData();
    fd.append("pdf", selFile);
    const resp = await fetch("/upload", { method: "POST", body: fd });
    const j = await resp.json();
    if (!resp.ok || !j.success) throw new Error(j.error || "Upload failed");

    let html = "";
    (j.added || []).forEach((p) => {
      html += `<div class="r-item r-ok"><strong>${p.vendor || "Logged"}</strong>${p.period ? ` — ${p.period}` : ""} (${p.sn})</div>`;
    });
    (j.skipped || []).forEach((p) => {
      html += `<div class="r-item r-err">⚠️ ${p.vendor || "Skipped"}: ${p.reason}</div>`;
    });
    if (!html) html = `<div class="r-item r-err">No invoices found in this PDF.</div>`;
    box.innerHTML = html;
    refreshStats();
  } catch (e) {
    box.innerHTML = `<div class="r-item r-err">❌ ${e.message}</div>`;
  } finally {
    setLoading("upBtn", null, null, false);
  }
}

// ── Attach tracker ────────────────────────────────────────────────────────
let selTrFile = null;

async function restoreTracker() {
  if (!selTrFile) return;
  if (!confirm("This replaces the current tracker with the uploaded file. Continue?")) return;

  setLoading("trBtn", null, null, true);
  const box = document.getElementById("trResult");
  box.style.display = "block";
  box.innerHTML = `<div style="color:#1F4E79">⏳ Attaching...</div>`;

  try {
    const fd = new FormData();
    fd.append("tracker", selTrFile);
    const resp = await fetch("/upload-tracker", { method: "POST", body: fd });
    const j = await resp.json();
    if (!resp.ok || !j.success) throw new Error(j.error || "Attach failed");

    box.innerHTML = `<div class="r-item r-ok">✅ Attached — now tracking ${j.row_count} invoice${j.row_count !== 1 ? "s" : ""}. Reloading...</div>`;
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    box.innerHTML = `<div class="r-item r-err">❌ ${e.message}</div>`;
    setLoading("trBtn", null, null, false);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  refreshAccountStatus();

  const dz = document.getElementById("dz");
  const fi = document.getElementById("fi");
  if (dz) {
    dz.addEventListener("click", () => fi.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("over");
      setFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener("change", () => setFile(fi.files[0]));
  }

  const trFile = document.getElementById("trFile");
  if (trFile) {
    trFile.addEventListener("change", () => {
      selTrFile = trFile.files[0] || null;
      document.getElementById("trBtn").disabled = !selTrFile;
    });
  }

  // Resume polling a scan that was in progress when the page was reloaded.
  const existingJobId = sessionStorage.getItem("inda_job_id");
  if (existingJobId) {
    setLoading("scanBtn", "scanSpinner", "scanLabel", true);
    document.getElementById("scanResult").style.display = "block";
    pollJob(existingJobId);
  }
});
