const pdfParse = require("pdf-parse");
const { OCR_THRESHOLD } = require("../config");

// Primary text extraction (closest Node analog to pdfplumber's text-layer
// read). No local OCR fallback here anymore - tesseract's system binary
// can't run on this shared host. Callers check needsMultimodalFallback and
// hand the raw PDF bytes to Gemini directly when true (geminiClient.js).
async function extractPdfText(buffer) {
  let text = "";
  try {
    const data = await pdfParse(buffer);
    text = data.text || "";
  } catch (err) {
    text = `[PDF read error: ${err.message}]`;
  }
  return {
    text,
    needsMultimodalFallback: text.trim().length < OCR_THRESHOLD,
  };
}

module.exports = { extractPdfText };
