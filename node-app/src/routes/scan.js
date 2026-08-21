const express = require("express");
const crypto = require("crypto");
const jobStore = require("../services/jobStore");
const scanJob = require("../services/scanJob");
const tokenStore = require("../services/tokenStore");
const { MAX_SCAN_LIMIT } = require("../config");

const router = express.Router();

router.post("/start", express.json(), (req, res) => {
  if (!tokenStore.getActiveAccount()) {
    return res.status(400).json({ error: "No Google account connected. Connect one first." });
  }
  if (scanJob.isRunning()) {
    return res.status(409).json({ error: "scan_already_running", jobId: scanJob.getActiveJobId() });
  }

  const senderFilter = String((req.body && req.body.senderFilter) || "").trim();
  const dateFrom = String((req.body && req.body.dateFrom) || "").trim();
  let limit = parseInt((req.body && req.body.limit) || 20, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_SCAN_LIMIT) limit = MAX_SCAN_LIMIT;

  const jobId = crypto.randomUUID();
  jobStore.createJob(jobId, { senderFilter, dateFrom, limit });

  // Fire-and-forget - the whole point is this does NOT stay tied to this
  // HTTP request/response cycle, so no host's request timeout can kill it.
  scanJob.run(jobId, { senderFilter, dateFrom, limit }).catch(() => {
    // scanJob.run already catches its own errors into the job file; this
    // catch only guards against a truly unexpected throw outside that.
  });

  res.status(202).json({ jobId });
});

router.get("/active", (req, res) => {
  const jobId = scanJob.getActiveJobId();
  res.json({ jobId: jobId || null });
});

router.get("/:jobId", (req, res) => {
  const job = jobStore.readJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "unknown_job" });
  res.json(job);
});

router.post("/:jobId/cancel", express.json(), (req, res) => {
  const job = jobStore.readJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "unknown_job" });
  if (job.status !== "running" && job.status !== "starting") {
    return res.json({ ok: true, message: "Job is not running.", status: job.status });
  }
  scanJob.requestCancel(req.params.jobId);
  res.json({ ok: true, message: "Cancellation requested." });
});

module.exports = router;
