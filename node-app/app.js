const express = require("express");
const debugRoutes = require("./src/routes/debug");
const authRoutes = require("./src/routes/auth");
const scanRoutes = require("./src/routes/scan");
const tokenStore = require("./src/services/tokenStore");

const app = express();

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "invoice-extractor-node is up",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  const email = tokenStore.getActiveAccount();
  res.json({
    message: "invoice-extractor-node — real frontend not built yet (Phase 5).",
    connected: Boolean(email),
    email: email || null,
    connectHint: email ? null : "Visit /auth/google to connect a Gmail account.",
  });
});

app.use("/debug", debugRoutes);
app.use("/auth", authRoutes);
app.use("/scan", scanRoutes);

module.exports = app;
