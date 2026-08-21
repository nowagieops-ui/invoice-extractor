const fs = require("fs");
const { PROCESSED_LOG } = require("../config");
const { COL, DATA_START_ROW } = require("./excelTracker");

// ── Already-scanned-email tracking, keyed on Gmail's own message id ───────
// Simpler and more reliable than the original Python app's IMAP sequence
// numbers (which shift as the mailbox changes) or even an RFC Message-ID
// header - Gmail's id is stable, unique per account, and needs no parsing.
function loadProcessedIds() {
  if (!fs.existsSync(PROCESSED_LOG)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(PROCESSED_LOG, "utf8")));
  } catch (_) {
    return new Set();
  }
}

function saveProcessedIds(idSet) {
  fs.writeFileSync(PROCESSED_LOG, JSON.stringify([...idSet]));
}

// ── Content-based dedup: skip a record whose vendor+invoice_number (or
// vendor+invoice_period as a fallback) already exists in the sheet, so an
// attached/restored tracker's existing rows are respected too, not just
// previously-scanned-email history. ─────────────────────────────────────
function normKey(...parts) {
  return parts.map((p) => String(p || "").trim().toUpperCase()).join("||");
}

// Builds two lookup maps from the current sheet contents. Rebuilt fresh at
// the start of every operation that appends rows (a scan job, a manual
// upload) rather than cached across requests - row counts here are small
// (hundreds), so a fresh parse is cheap and avoids any staleness after
// /upload-tracker swaps the whole workbook out from under a cached index.
function buildIndex(ws) {
  const byInvoiceNumber = new Map();
  const byPeriod = new Map();

  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const vendor = ws.getCell(r, COL.VENDOR).value;
    if (vendor == null) continue;
    const invoiceNumber = ws.getCell(r, COL.INVOICE_NUMBER).value;
    const invoicePeriod = ws.getCell(r, COL.INVOICE_PERIOD).value;
    if (invoiceNumber != null && String(invoiceNumber).trim()) {
      byInvoiceNumber.set(normKey(vendor, invoiceNumber), r);
    }
    if (invoicePeriod != null && String(invoicePeriod).trim()) {
      byPeriod.set(normKey(vendor, invoicePeriod), r);
    }
  }

  return {
    // Returns the matching row number, or null if this record is new.
    find(vendor, invoiceNumber, invoicePeriod) {
      if (invoiceNumber) {
        const hit = byInvoiceNumber.get(normKey(vendor, invoiceNumber));
        if (hit) return hit;
      }
      if (invoicePeriod) {
        const hit = byPeriod.get(normKey(vendor, invoicePeriod));
        if (hit) return hit;
      }
      return null;
    },
    // Called right after a new row is appended, so two duplicate PDFs
    // within the *same* scan also get caught, not just dupes against
    // pre-existing rows.
    add(vendor, invoiceNumber, invoicePeriod, rowIndex) {
      if (invoiceNumber) byInvoiceNumber.set(normKey(vendor, invoiceNumber), rowIndex);
      if (invoicePeriod) byPeriod.set(normKey(vendor, invoicePeriod), rowIndex);
    },
  };
}

module.exports = { loadProcessedIds, saveProcessedIds, buildIndex };
