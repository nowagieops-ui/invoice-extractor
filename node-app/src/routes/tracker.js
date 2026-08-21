const express = require("express");
const fs = require("fs");
const multer = require("multer");
const ExcelJS = require("exceljs");
const excelTracker = require("../services/excelTracker");
const { EXCEL_FILE } = require("../config");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Attach a tracker (a previous backup, or one already in use) as the
// ongoing target future scans append to - not just a one-time restore.
// Same validation and backup-before-replace behavior as the original app's
// /upload-tracker route.
router.post("/upload-tracker", upload.single("tracker"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No tracker file uploaded (field name must be 'tracker')." });
  }
  if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) {
    return res.status(400).json({ error: "Please upload an .xlsx file" });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Not a valid Excel file: ${err.message}` });
  }

  const ws = wb.getWorksheet(excelTracker.SHEET_NAME);
  if (!ws) {
    return res.status(400).json({ error: "This file has no 'INVOICE' sheet — is it the right tracker file?" });
  }

  if (fs.existsSync(EXCEL_FILE)) {
    fs.copyFileSync(EXCEL_FILE, `${EXCEL_FILE}.bak`);
  }
  fs.writeFileSync(EXCEL_FILE, req.file.buffer);

  res.json({ success: true, row_count: excelTracker.rowCount(ws) });
});

router.get("/download", (req, res) => {
  if (!fs.existsSync(EXCEL_FILE)) {
    return res.redirect("/");
  }
  res.download(EXCEL_FILE, "INDA_Invoice_Tracker.xlsx");
});

module.exports = router;
