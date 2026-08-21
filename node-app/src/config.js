const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const TOKENS_DIR = path.join(DATA_DIR, "tokens");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const OUTPUT_DIR = path.join(DATA_DIR, "output");
fs.mkdirSync(TOKENS_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

module.exports = {
  DATA_DIR,
  TOKENS_DIR,
  JOBS_DIR,
  OUTPUT_DIR,
  EXCEL_FILE: path.join(OUTPUT_DIR, "INDA_Invoice_Tracker.xlsx"),
  PROCESSED_LOG: path.join(OUTPUT_DIR, "processed_ids.json"),
  PORT: process.env.PORT || 3000,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  OCR_THRESHOLD: 50,
  MAX_SCAN_LIMIT: 500,

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || "",
  // Refresh tokens are a standing credential for the connected mailbox (the
  // Internal OAuth app type means they don't expire) - encrypted at rest so
  // reading one file on this shared host doesn't hand out live mail access.
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "",

  // Shared secret required on /debug/* routes so a public URL can't be used
  // by strangers to burn Gemini quota or probe the disk. Set this in
  // Hostinger's env var UI before deploying; unset it and stop deploying
  // this app once Phase 0 verification is done.
  DEBUG_TOKEN: process.env.DEBUG_TOKEN || "",
};
