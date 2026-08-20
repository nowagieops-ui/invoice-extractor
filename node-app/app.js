const express = require("express");
const debugRoutes = require("./src/routes/debug");

const app = express();

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "invoice-extractor-node Phase 0 smoke test is up",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

app.use("/debug", debugRoutes);

module.exports = app;
