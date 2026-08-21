const express = require("express");
const excelTracker = require("../services/excelTracker");

const router = express.Router();

const DISPLAY_HEADERS = [
  "S/N", "Soft Copy", "Vendor Name", "Recv by Finance", "Recv by Coord", "PO/SO",
  "BH Recv", "BH Decision", "Audit Recv", "Audit Decision", "CC Recv", "CC Decision",
  "GM Recv", "GM Decision", "Finance Name", "Finance Date", "Rejection Reason",
  "Invoice Number", "Invoice Period",
];

router.get("/", async (req, res) => {
  const rows = await excelTracker.getAllRowsIfExists();
  res.render("preview", { headers: DISPLAY_HEADERS, rows });
});

module.exports = router;
