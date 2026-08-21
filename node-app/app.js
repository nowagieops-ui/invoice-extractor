const path = require("path");
const express = require("express");
const debugRoutes = require("./src/routes/debug");
const authRoutes = require("./src/routes/auth");
const scanRoutes = require("./src/routes/scan");
const uploadRoutes = require("./src/routes/upload");
const trackerRoutes = require("./src/routes/tracker");
const previewRoutes = require("./src/routes/preview");
const tokenStore = require("./src/services/tokenStore");
const excelTracker = require("./src/services/excelTracker");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "invoice-extractor-node is up",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

app.get("/", async (req, res) => {
  const rowCount = await excelTracker.getRowCountIfExists();
  res.render("index", { rowCount });
});

// Lets the frontend refresh the "Tracked" stat live after a scan finishes,
// without a full page reload.
app.get("/stats", async (req, res) => {
  res.json({ rowCount: await excelTracker.getRowCountIfExists() });
});

app.use("/debug", debugRoutes);
app.use("/auth", authRoutes);
app.use("/scan", scanRoutes);
app.use("/upload", uploadRoutes);
app.use("/", trackerRoutes);
app.use("/preview", previewRoutes);

// Every route on this app is called from client JS expecting JSON back -
// without this, an error thrown before a route handler's own try/catch
// (e.g. multer rejecting an oversized file, or a malformed multipart body)
// falls through to Express's default HTML error page, which then breaks
// the frontend's response.json() call with a confusing "Unexpected token
// '<'" error instead of a real message.
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 20 MB)." : `Upload error: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: (err && err.message) || "Internal server error" });
});

module.exports = app;
