const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
  DATA_DIR,
  PORT: process.env.PORT || 3000,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  // Shared secret required on /debug/* routes so a public URL can't be used
  // by strangers to burn Gemini quota or probe the disk. Set this in
  // Hostinger's env var UI before deploying; unset it and stop deploying
  // this app once Phase 0 verification is done.
  DEBUG_TOKEN: process.env.DEBUG_TOKEN || "",
};
