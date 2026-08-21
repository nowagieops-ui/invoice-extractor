// The extraction -> dedup -> append pipeline shared by the background scan
// job (scanJob.js) and the manual single-PDF upload route, so there's one
// place that knows how to turn PDF bytes into tracker rows.
const pdfText = require("./pdfText");
const gemini = require("./geminiClient");
const excelTracker = require("./excelTracker");

// ctx: { wb, ws, index, nextRow } - nextRow is read and returned updated
// (not mutated in place) since JS numbers are passed by value.
// Returns { logged: [...], skipped: [...], nextRow }.
async function extractAndAppend(buffer, ctx) {
  const { text, needsMultimodalFallback } = await pdfText.extractPdfText(buffer);

  const records = needsMultimodalFallback
    ? await gemini.extractFromPdfBytes(buffer)
    : await gemini.extractFromText(text);

  const logged = [];
  const skipped = [];
  let nextRow = ctx.nextRow;

  for (const rec of records) {
    const dupRow = ctx.index.find(rec.vendor, rec.invoice_number, rec.invoice_period);
    if (dupRow) {
      skipped.push({ vendor: rec.vendor, reason: `Duplicate of existing row ${dupRow}` });
      continue;
    }

    const sn = excelTracker.nextSn(ctx.ws);
    const rowData = {
      sn,
      vendor: rec.vendor,
      receivedFinance: rec.received_finance || rec.invoice_date,
      receivedCoordinator: null,
      poSo: `${rec.invoice_number || ""} | ${rec.po_so || ""}`,
      bhRecv: rec.budget_holder_date,
      bhDate: rec.budget_holder_date,
      bhStatus: rec.budget_holder_status || "PENDING",
      auditRecv: rec.audit_date,
      auditDate: rec.audit_date,
      auditStatus: rec.audit_status || "PENDING",
      ccRecv: rec.cost_control_date,
      ccDate: rec.cost_control_date,
      ccStatus: rec.cost_control_status || "PENDING",
      gmRecv: rec.gm_finance_date,
      gmDate: rec.gm_finance_date,
      gmStatus: rec.gm_finance_status || "PENDING",
      financeName: null,
      financeDate: null,
      rejectionReason: rec.rejection_reason,
      invoiceNumber: rec.invoice_number,
      invoicePeriod: rec.invoice_period,
    };

    await excelTracker.appendRow(ctx.wb, ctx.ws, rowData, nextRow);
    ctx.index.add(rec.vendor, rec.invoice_number, rec.invoice_period, nextRow);
    nextRow++;

    logged.push({
      sn,
      vendor: rec.vendor,
      period: rec.invoice_period,
      budget_holder: `${rec.budget_holder_name || ""} — ${rec.budget_holder_status || ""}`,
      audit: `${rec.audit_name || ""} — ${rec.audit_status || ""}`,
      rejection: rec.rejection_reason,
    });
  }

  return { logged, skipped, nextRow };
}

module.exports = { extractAndAppend };
