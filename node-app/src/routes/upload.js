const express = require("express");
const multer = require("multer");
const excelTracker = require("../services/excelTracker");
const dedup = require("../services/dedup");
const invoicePipeline = require("../services/invoicePipeline");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB, matches the UI's stated max
});

// Manual single-PDF upload — synchronous (single file, no need for the
// background-job machinery), but uses the exact same extraction -> dedup
// -> append pipeline as the background scan job, not a forked copy.
router.post("/", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded (field name must be 'pdf')." });
  }
  if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "PDF files only" });
  }

  try {
    const { wb, ws } = await excelTracker.getOrCreateWorkbook();
    const index = dedup.buildIndex(ws);
    const nextRow = excelTracker.lastDataRow(ws) + 1;

    const outcome = await invoicePipeline.extractAndAppend(req.file.buffer, { wb, ws, index, nextRow });

    res.json({
      success: true,
      added: outcome.logged.map((r) => ({ sn: r.sn, vendor: r.vendor, period: r.period })),
      skipped: outcome.skipped,
      count: outcome.logged.length,
    });
  } catch (err) {
    res.status(500).json({ error: `Extraction failed: ${err.message}` });
  }
});

module.exports = router;
