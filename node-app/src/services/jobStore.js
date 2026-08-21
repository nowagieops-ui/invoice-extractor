const fs = require("fs");
const path = require("path");
const { JOBS_DIR } = require("../config");

const LOG_CAP = 300;

function jobFile(jobId) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

// Atomic write: write to a temp file then rename over the real one, so a
// poller can never read a half-written JSON file.
function writeJob(job) {
  job.updatedAt = new Date().toISOString();
  const file = jobFile(job.jobId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, file);
  return job;
}

function readJob(jobId) {
  const file = jobFile(jobId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function createJob(jobId, params) {
  return writeJob({
    jobId,
    status: "starting",
    startedAt: new Date().toISOString(),
    params,
    progress: { current: 0, total: 0, message: "Starting..." },
    log: [],
    counts: { logged: 0, skippedDuplicate: 0, skippedNoText: 0, errors: 0, alreadyProcessed: 0 },
    result: null,
    error: null,
    errorType: null,
  });
}

function appendLog(job, message) {
  job.log.push(message);
  if (job.log.length > LOG_CAP) job.log.splice(0, job.log.length - LOG_CAP);
  return writeJob(job);
}

function setProgress(job, current, total, message) {
  job.progress = { current, total, message };
  return writeJob(job);
}

function markDone(job, result) {
  job.status = "done";
  job.result = result;
  return writeJob(job);
}

function markError(job, message, errorType) {
  job.status = "error";
  job.error = { message };
  job.errorType = errorType || null;
  return writeJob(job);
}

function markCancelled(job) {
  job.status = "cancelled";
  return writeJob(job);
}

// On process boot, any job still "running"/"starting" definitely died with
// the previous process instance. Mark it as a truthful terminal error so a
// client still polling that job id gets a real answer instead of an
// indefinite "running" status, and so the single-job lock gets released.
function reconcileOrphanedJobs() {
  if (!fs.existsSync(JOBS_DIR)) return;
  const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
  for (const f of files) {
    const jobId = f.replace(/\.json$/, "");
    const job = readJob(jobId);
    if (job && (job.status === "running" || job.status === "starting")) {
      markError(
        job,
        "Server restarted while this scan was in progress. Anything logged before the restart is safely saved in the tracker.",
        "server_restart"
      );
    }
  }
}

module.exports = {
  createJob,
  readJob,
  writeJob,
  appendLog,
  setProgress,
  markDone,
  markError,
  markCancelled,
  reconcileOrphanedJobs,
};
