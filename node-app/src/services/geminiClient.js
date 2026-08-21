const { GoogleGenAI } = require("@google/genai");
const { GEMINI_API_KEY } = require("../config");

const MODEL = "gemini-3.5-flash";

const RESPONSE_KEYS = `vendor, invoice_number, invoice_date, po_so, invoice_amount,
received_finance, invoice_period,
budget_holder_name, budget_holder_date, budget_holder_status,
audit_name, audit_date, audit_status,
cost_control_name, cost_control_date, cost_control_status,
gm_finance_name, gm_finance_date, gm_finance_status,
rejection_reason`;

const RULES = `Rules:
- Status fields must be exactly: APPROVED, REJECTED, or PENDING
- Dates in DD/MM/YYYY format only
- If signed and dated = APPROVED, if blank = PENDING, if crossed out = REJECTED
- For invoice_date use the last day of the service period if no date shown (e.g. 28/02/2026 for February 2026)
- Return an array always, even for one invoice`;

const EXAMPLE =
  '[{"vendor":"TRAMATHY GLOBAL SERVICES LIMITED","invoice_number":"TGSL/BPL/KULA/02/2026","invoice_date":"28/02/2026","po_so":"BPL055C25-0104.05","invoice_amount":"3154775","received_finance":"02/03/2026","invoice_period":"FEBRUARY 2026","budget_holder_name":"SAMUEL ABEL-JUMBO","budget_holder_date":"04/08/2026","budget_holder_status":"APPROVED","audit_name":"BEN OKOH","audit_date":"06/08/2026","audit_status":"APPROVED","cost_control_name":null,"cost_control_date":null,"cost_control_status":"PENDING","gm_finance_name":null,"gm_finance_date":null,"gm_finance_status":"PENDING","rejection_reason":null}]';

function buildTextPrompt(pdfText) {
  return `Extract invoice approval data from this PDF and return ONLY a JSON array.
No markdown, no explanation, just the raw JSON array.

Each element must have these exact keys (use null for missing values):
${RESPONSE_KEYS}

${RULES}

PDF TEXT:
${pdfText.slice(0, 5000)}`;
}

function buildMultimodalPrompt() {
  return `This PDF is likely a scanned or image-based invoice approval document. Read it directly - including any signatures, stamps, handwriting, or checkboxes - and return ONLY a JSON array.

Each element must have these exact keys (use null for missing values):
${RESPONSE_KEYS}

${RULES}`;
}

function cleanAndParse(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/```json/gi, "").replace(/```JSON/g, "").replace(/```/g, "").trim();

  const tryParse = (str) => {
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) {
      return null;
    }
  };

  const startArr = s.indexOf("[");
  const endArr = s.lastIndexOf("]");
  if (startArr !== -1 && endArr !== -1 && startArr < endArr) {
    const r = tryParse(s.slice(startArr, endArr + 1));
    if (r) return r;
  }
  const startObj = s.indexOf("{");
  const endObj = s.lastIndexOf("}");
  if (startObj !== -1 && endObj !== -1 && startObj < endObj) {
    const r = tryParse(s.slice(startObj, endObj + 1));
    if (r) return r;
  }
  return tryParse(s);
}

let _client = null;
function client() {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY env var not set.");
  if (!_client) _client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _client;
}

// Ported near-verbatim from the Python app's extract_with_ai: try once with
// native JSON output, retry once with a one-shot example if parsing fails.
async function extractFromText(pdfText) {
  const resp = await client().models.generateContent({
    model: MODEL,
    contents: buildTextPrompt(pdfText),
    config: { temperature: 0, maxOutputTokens: 4000, responseMimeType: "application/json" },
  });
  let result = cleanAndParse(resp.text);
  if (result) return result;

  const prompt2 = `Return a JSON array like this example:\n${EXAMPLE}\n\nNow extract from this invoice text. Return ONLY the JSON array:\n${pdfText.slice(0, 3000)}`;
  const resp2 = await client().models.generateContent({
    model: MODEL,
    contents: prompt2,
    config: { temperature: 0, maxOutputTokens: 3000, responseMimeType: "application/json" },
  });
  result = cleanAndParse(resp2.text);
  if (result) return result;

  throw new Error(`Could not parse Gemini response. Raw: ${(resp2.text || "").slice(0, 300)}`);
}

// NEW: replaces local Tesseract OCR (impossible on this shared host). Sends
// the raw PDF bytes to Gemini directly as multimodal input, one call
// instead of local-OCR-then-text-call. Untested against real scanned
// invoices yet - flagged in the plan as needing a real-sample test before
// being trusted for production scans.
async function extractFromPdfBytes(buffer) {
  const resp = await client().models.generateContent({
    model: MODEL,
    contents: [
      { text: buildMultimodalPrompt() },
      { inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } },
    ],
    config: { temperature: 0, maxOutputTokens: 4000, responseMimeType: "application/json" },
  });
  const result = cleanAndParse(resp.text);
  if (!result) {
    throw new Error(`Could not parse Gemini multimodal response. Raw: ${(resp.text || "").slice(0, 300)}`);
  }
  return result;
}

module.exports = { extractFromText, extractFromPdfBytes };
