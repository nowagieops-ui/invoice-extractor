const fs = require("fs");
const ExcelJS = require("exceljs");
const { EXCEL_FILE } = require("../config");

const SHEET_NAME = "INVOICE";
const DATA_START_ROW = 5;

// Column layout. Columns 18-19 are new vs. the original Python app, which
// only packed invoice_number into the PO/SO display cell as
// "{invoice_number} | {po_so}" - stored here as their own columns so
// content-based dedup doesn't have to regex a display string a user might
// hand-edit in Excel. Added after column Q so an older/attached tracker
// without them still opens fine (missing value = "no index entry").
const COL = {
  SN: 1,
  SOFT_COPY: 2,
  VENDOR: 3,
  RECEIVED_FINANCE: 4,
  RECEIVED_COORDINATOR: 5,
  PO_SO: 6,
  BH_RECV: 7,
  BH_DECISION: 8,
  AUDIT_RECV: 9,
  AUDIT_DECISION: 10,
  CC_RECV: 11,
  CC_DECISION: 12,
  GM_RECV: 13,
  GM_DECISION: 14,
  FINANCE_NAME: 15,
  FINANCE_DATE: 16,
  REJECTION_REASON: 17,
  INVOICE_NUMBER: 18,
  INVOICE_PERIOD: 19,
};

const COLUMN_WIDTHS = [8, 10, 32, 14, 14, 28, 12, 20, 12, 20, 12, 20, 12, 20, 14, 12, 32, 18, 18];

const COLUMN_HEADERS = [
  "S/N",
  "SOFT COPY",
  "VENDOR NAME",
  "RECEIVED DATE\nBY FINANCE",
  "RECEIVED DATE\nBY COORDINATOR",
  "PO/SO NUMBER",
  "DATE\nRECEIVE (Budget Holder)",
  "DATE\nAPPROVE/REJECT (Budget Holder)",
  "DATE\nRECEIVE (Audit)",
  "DATE\nAPPROVE/REJECT (Audit)",
  "DATE\nRECEIVE (Cost Control)",
  "DATE\nAPPROVE/REJECT (Cost Control)",
  "DATE\nRECEIVE (GM Finance)",
  "DATE\nAPPROVE/REJECT (GM Finance)",
  "NAME (Submit to Finance)",
  "DATE (Submit to Finance)",
  "REASON FOR REJECTION",
  "INVOICE NUMBER",
  "INVOICE PERIOD",
];

const HEADER_GROUPS = { 7: "BUDGET HOLDER", 9: "AUDIT", 11: "COST CONTROL", 13: "GM FINANCE", 15: "SUBMIT TO FINANCE" };

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};
const CENTER = { horizontal: "center", vertical: "middle", wrapText: true };
const LEFT = { horizontal: "left", vertical: "middle", wrapText: true };

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const HEADER_FONT = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
const APPROVED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
const REJECTED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
const ROW_FILLS = [
  { type: "pattern", pattern: "solid", fgColor: { argb: "FFDEEAF1" } },
  { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } },
];

function font({ bold = false, color = "FF000000", size = 9 } = {}) {
  return { name: "Arial", bold, color: { argb: color }, size };
}

function writeCell(ws, row, col, value, fontStyle, fill, alignment) {
  const cell = ws.getCell(row, col);
  cell.value = value == null ? null : value;
  if (fontStyle) cell.font = fontStyle;
  if (fill) cell.fill = fill;
  if (alignment) cell.alignment = alignment;
  cell.border = THIN_BORDER;
  return cell;
}

function writeHeaders(ws) {
  ws.mergeCells(1, 1, 1, 17);
  writeCell(ws, 1, 1, "INDA PLATFORM", font({ bold: true, size: 12 }), null, CENTER);

  ws.mergeCells(2, 1, 2, 17);
  writeCell(ws, 2, 1, "INVOICES APPROVAL LINE TRACKING", font({ bold: true, size: 11 }), null, CENTER);

  for (const [colStr, label] of Object.entries(HEADER_GROUPS)) {
    const col = Number(colStr);
    ws.mergeCells(3, col, 3, col + 1);
    writeCell(ws, 3, col, label, HEADER_FONT, HEADER_FILL, CENTER);
  }

  COLUMN_HEADERS.forEach((label, i) => {
    writeCell(ws, 4, i + 1, label, HEADER_FONT, HEADER_FILL, CENTER);
  });
  ws.getRow(4).height = 36;

  COLUMN_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4 }];
}

async function getOrCreateWorkbook() {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(EXCEL_FILE)) {
    await wb.xlsx.readFile(EXCEL_FILE);
    let ws = wb.getWorksheet(SHEET_NAME);
    if (!ws) {
      ws = wb.addWorksheet(SHEET_NAME);
      writeHeaders(ws);
      await wb.xlsx.writeFile(EXCEL_FILE);
    }
    return { wb, ws };
  }
  const ws = wb.addWorksheet(SHEET_NAME);
  writeHeaders(ws);
  await wb.xlsx.writeFile(EXCEL_FILE);
  return { wb, ws };
}

function lastDataRow(ws) {
  let last = DATA_START_ROW - 1;
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    if (ws.getCell(r, COL.SN).value != null) last = r;
  }
  return last;
}

function nextSn(ws) {
  const year = String(new Date().getFullYear()).slice(-2);
  let maxNum = 0;
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const val = ws.getCell(r, COL.SN).value;
    if (val == null) continue;
    const m = String(val).match(new RegExp(`^${year}-(\\d+)$`));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `${year}-${String(maxNum + 1).padStart(2, "0")}`;
}

function approvalFill(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("APPROVED")) return APPROVED_FILL;
  if (s.includes("REJECT")) return REJECTED_FILL;
  return null; // caller substitutes the row-banding fill
}

function approvalFont(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("APPROVED")) return font({ bold: true, color: "FF276749" });
  if (s.includes("REJECT")) return font({ bold: true, color: "FF9C0006" });
  return font();
}

// data: { sn, vendor, receivedFinance, receivedCoordinator, poSo,
//   bhRecv, bhDate, bhStatus, auditRecv, auditDate, auditStatus,
//   ccRecv, ccDate, ccStatus, gmRecv, gmDate, gmStatus,
//   financeName, financeDate, rejectionReason, invoiceNumber, invoicePeriod }
async function appendRow(wb, ws, data, rowIndex) {
  const r = rowIndex;
  const bandFill = ROW_FILLS[r % 2];

  writeCell(ws, r, COL.SN, data.sn, font({ bold: true }), bandFill, CENTER);
  writeCell(ws, r, COL.SOFT_COPY, null, font(), bandFill, CENTER);
  writeCell(ws, r, COL.VENDOR, data.vendor, font({ bold: true }), bandFill, LEFT);
  writeCell(ws, r, COL.RECEIVED_FINANCE, data.receivedFinance, font(), bandFill, CENTER);
  writeCell(ws, r, COL.RECEIVED_COORDINATOR, data.receivedCoordinator, font(), bandFill, CENTER);
  writeCell(ws, r, COL.PO_SO, data.poSo, font(), bandFill, LEFT);

  writeCell(ws, r, COL.BH_RECV, data.bhRecv, font(), bandFill, CENTER);
  writeCell(
    ws, r, COL.BH_DECISION,
    `${data.bhDate || ""} ${data.bhStatus || ""}`.trim(),
    approvalFont(data.bhStatus), approvalFill(data.bhStatus) || bandFill, CENTER
  );

  writeCell(ws, r, COL.AUDIT_RECV, data.auditRecv, font(), bandFill, CENTER);
  writeCell(
    ws, r, COL.AUDIT_DECISION,
    `${data.auditDate || ""} ${data.auditStatus || ""}`.trim(),
    approvalFont(data.auditStatus), approvalFill(data.auditStatus) || bandFill, CENTER
  );

  writeCell(ws, r, COL.CC_RECV, data.ccRecv, font(), bandFill, CENTER);
  writeCell(
    ws, r, COL.CC_DECISION,
    `${data.ccDate || ""} ${data.ccStatus || ""}`.trim(),
    approvalFont(data.ccStatus), approvalFill(data.ccStatus) || bandFill, CENTER
  );

  writeCell(ws, r, COL.GM_RECV, data.gmRecv, font(), bandFill, CENTER);
  writeCell(
    ws, r, COL.GM_DECISION,
    `${data.gmDate || ""} ${data.gmStatus || ""}`.trim(),
    approvalFont(data.gmStatus), approvalFill(data.gmStatus) || bandFill, CENTER
  );

  writeCell(ws, r, COL.FINANCE_NAME, data.financeName, font(), bandFill, CENTER);
  writeCell(ws, r, COL.FINANCE_DATE, data.financeDate, font(), bandFill, CENTER);
  writeCell(ws, r, COL.REJECTION_REASON, data.rejectionReason, font(), bandFill, LEFT);
  writeCell(ws, r, COL.INVOICE_NUMBER, data.invoiceNumber, font(), bandFill, CENTER);
  writeCell(ws, r, COL.INVOICE_PERIOD, data.invoicePeriod, font(), bandFill, CENTER);

  ws.getRow(r).height = 45;

  // Saved after every single row, same as the Python app - limits data loss
  // to at most one in-flight record if the process dies mid-scan.
  await wb.xlsx.writeFile(EXCEL_FILE);
}

function rowCount(ws) {
  return Math.max(0, lastDataRow(ws) - (DATA_START_ROW - 1));
}

// Read-only stat check for page loads - does NOT create the tracker file
// as a side effect of just checking the count (unlike getOrCreateWorkbook),
// same behavior as the original app's index route.
async function getRowCountIfExists() {
  if (!fs.existsSync(EXCEL_FILE)) return 0;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  return ws ? rowCount(ws) : 0;
}

// Read-only data dump for /preview - also does not create the file.
async function getAllRowsIfExists() {
  if (!fs.existsSync(EXCEL_FILE)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) return [];
  const rows = [];
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const values = [];
    let hasValue = false;
    for (let c = 1; c <= COLUMN_HEADERS.length; c++) {
      const v = ws.getCell(r, c).value;
      if (v != null) hasValue = true;
      values.push(v);
    }
    if (hasValue) rows.push(values);
  }
  return rows;
}

module.exports = {
  SHEET_NAME,
  DATA_START_ROW,
  COL,
  COLUMN_HEADERS,
  getOrCreateWorkbook,
  writeHeaders,
  lastDataRow,
  getRowCountIfExists,
  getAllRowsIfExists,
  nextSn,
  appendRow,
  rowCount,
};
