const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TOKENS_DIR, TOKEN_ENCRYPTION_KEY } = require("../config");

const ACTIVE_FILE = path.join(TOKENS_DIR, "active.json");

function sanitize(email) {
  return email.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function tokenFile(email) {
  return path.join(TOKENS_DIR, `${sanitize(email)}.json`);
}

function deriveKey() {
  if (!TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY env var not set — refusing to read/write tokens.");
  }
  return crypto.createHash("sha256").update(TOKEN_ENCRYPTION_KEY).digest();
}

function encrypt(plainObj) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plainObj), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(encrypted) {
  const key = deriveKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

// tokens: { refresh_token, access_token?, expiry_date?, scope? } — whatever
// googleapis's OAuth2Client.getToken() returned. Only refresh_token actually
// matters long-term; the rest is convenience.
function saveToken(email, tokens) {
  const record = {
    email,
    connectedAt: new Date().toISOString(),
    encrypted: encrypt({ refresh_token: tokens.refresh_token }),
  };
  fs.writeFileSync(tokenFile(email), JSON.stringify(record, null, 2));
}

// Returns { refresh_token } or null if not connected / undecryptable (treated
// the same as "not connected" by callers - surfaces as a reconnect prompt).
function loadToken(email) {
  const file = tokenFile(email);
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return decrypt(record.encrypted);
  } catch (_) {
    return null;
  }
}

function deleteToken(email) {
  const file = tokenFile(email);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function setActiveAccount(email) {
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ email }, null, 2));
}

function getActiveAccount() {
  if (!fs.existsSync(ACTIVE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")).email || null;
  } catch (_) {
    return null;
  }
}

function clearActiveAccount() {
  if (fs.existsSync(ACTIVE_FILE)) fs.unlinkSync(ACTIVE_FILE);
}

module.exports = {
  saveToken,
  loadToken,
  deleteToken,
  setActiveAccount,
  getActiveAccount,
  clearActiveAccount,
};
