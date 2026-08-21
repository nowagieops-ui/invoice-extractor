const express = require("express");
const crypto = require("crypto");
const googleAuth = require("../services/googleAuth");
const tokenStore = require("../services/tokenStore");

const router = express.Router();

// In-memory CSRF state store. Single-process app, short-lived (a few
// minutes at most between redirect-out and callback), so no persistence
// needed - a process restart mid-consent just means the user retries.
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, createdAt] of pendingStates) {
    if (now - createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

router.get("/google", (req, res) => {
  cleanupExpiredStates();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  try {
    res.redirect(googleAuth.getAuthUrl(state));
  } catch (err) {
    res.status(500).send(`Google OAuth is not configured yet: ${err.message}`);
  }
});

router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(String(error))}`);
  }
  if (!state || !pendingStates.has(String(state))) {
    return res.status(400).send("Missing or expired state parameter - please try connecting again.");
  }
  pendingStates.delete(String(state));

  if (!code) {
    return res.status(400).send("Missing authorization code from Google.");
  }

  try {
    const email = await googleAuth.exchangeCode(String(code));
    res.redirect(`/?connected=${encodeURIComponent(email)}`);
  } catch (err) {
    res.status(502).send(`Could not complete Google sign-in: ${err.message}`);
  }
});

router.get("/google/status", (req, res) => {
  const email = tokenStore.getActiveAccount();
  res.json({ connected: Boolean(email), email: email || null });
});

router.post("/google/disconnect", express.json(), async (req, res) => {
  const email = tokenStore.getActiveAccount();
  if (!email) {
    return res.json({ ok: true, message: "Nothing was connected." });
  }
  await googleAuth.disconnect(email);
  res.json({ ok: true });
});

module.exports = router;
