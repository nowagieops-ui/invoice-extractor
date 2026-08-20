const express = require("express");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { GoogleGenAI } = require("@google/genai");
const { DATA_DIR, GEMINI_API_KEY, DEBUG_TOKEN } = require("../config");

const router = express.Router();

// Every /debug/* route requires ?token=<DEBUG_TOKEN> so a public URL can't
// be hit by strangers to burn Gemini quota or probe the disk.
router.use((req, res, next) => {
  if (!DEBUG_TOKEN) {
    return res.status(503).json({
      error: "DEBUG_TOKEN env var not set — set it in Hostinger's env var UI before using /debug routes.",
    });
  }
  if (req.query.token !== DEBUG_TOKEN) {
    return res.status(401).json({ error: "Missing or wrong ?token=" });
  }
  next();
});

// ── /debug/imap-check ───────────────────────────────────────────────────
// Opens a raw TLS socket to imap.gmail.com:993 — no login, no credentials.
// This isolates the one question that matters: is outbound port 993
// reachable at all from this shared-hosting network. If this fails, the
// whole rewrite is moot regardless of anything else.
router.get("/imap-check", (req, res) => {
  const host = req.query.host || "imap.gmail.com";
  const port = Number(req.query.port || 993);
  const timeoutMs = 8000;

  const socket = tls.connect({ host, port, timeout: timeoutMs }, () => {
    const result = {
      ok: true,
      host,
      port,
      message: `TLS handshake succeeded to ${host}:${port}`,
      authorized: socket.authorized,
    };
    socket.destroy();
    res.json(result);
  });

  socket.setTimeout(timeoutMs, () => {
    socket.destroy();
    res.status(504).json({
      ok: false,
      host,
      port,
      message: `Connection to ${host}:${port} timed out after ${timeoutMs}ms — port is likely blocked outbound.`,
    });
  });

  socket.on("error", (err) => {
    res.status(502).json({
      ok: false,
      host,
      port,
      message: `Connection failed: ${err.message}`,
    });
  });
});

// ── /debug/gemini-check ─────────────────────────────────────────────────
// One trivial text call — confirms outbound HTTPS to Gemini's API works
// and GEMINI_API_KEY is readable from the environment.
router.get("/gemini-check", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ ok: false, message: "GEMINI_API_KEY env var not set." });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const resp = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "Reply with exactly the word: pong",
    });
    res.json({ ok: true, message: "Gemini call succeeded", reply: (resp.text || "").trim() });
  } catch (err) {
    res.status(502).json({ ok: false, message: `Gemini call failed: ${err.message}` });
  }
});

// ── /debug/disk-check ────────────────────────────────────────────────────
// Writes a counter to disk and reads back whatever was there before this
// call. Call it, redeploy the app, call it again — if the count kept
// incrementing across the redeploy, the data dir survives redeploys.
router.get("/disk-check", (req, res) => {
  const file = path.join(DATA_DIR, "disk-check.json");
  let previous = null;
  if (fs.existsSync(file)) {
    try {
      previous = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      previous = { note: "existing file was unreadable" };
    }
  }
  const next = {
    count: (previous && previous.count ? previous.count : 0) + 1,
    lastWrittenAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  res.json({ ok: true, dataDir: DATA_DIR, previous, current: next });
});

// ── /debug/long-task ─────────────────────────────────────────────────────
// Starts (once) a background async task that runs for 10 minutes,
// writing progress to disk every 30s, independent of any single HTTP
// request. Hit this route repeatedly over ~10 minutes to see whether the
// task keeps progressing — that's the load-bearing assumption for the
// real background-scan architecture.
let longTaskState = null; // in-memory; also persisted to disk each tick

function longTaskFile() {
  return path.join(DATA_DIR, "long-task.json");
}

async function runLongTask() {
  const durationMs = 10 * 60 * 1000;
  const tickMs = 30 * 1000;
  const startedAt = Date.now();
  longTaskState = { status: "running", startedAt: new Date(startedAt).toISOString(), ticks: 0 };
  fs.writeFileSync(longTaskFile(), JSON.stringify(longTaskState, null, 2));

  while (Date.now() - startedAt < durationMs) {
    await new Promise((r) => setTimeout(r, tickMs));
    longTaskState.ticks += 1;
    longTaskState.lastTickAt = new Date().toISOString();
    fs.writeFileSync(longTaskFile(), JSON.stringify(longTaskState, null, 2));
  }

  longTaskState.status = "done";
  longTaskState.finishedAt = new Date().toISOString();
  fs.writeFileSync(longTaskFile(), JSON.stringify(longTaskState, null, 2));
}

router.get("/long-task", (req, res) => {
  if (!longTaskState || longTaskState.status !== "running") {
    // Not running in this process's memory — check disk in case this is a
    // fresh process (restart) picking up mid-task state, or start fresh.
    if (fs.existsSync(longTaskFile())) {
      try {
        longTaskState = JSON.parse(fs.readFileSync(longTaskFile(), "utf8"));
      } catch (_) {
        longTaskState = null;
      }
    }
  }

  if (req.query.start === "1" && (!longTaskState || longTaskState.status !== "running")) {
    longTaskState = { status: "starting" };
    runLongTask().catch((err) => {
      longTaskState = { status: "error", message: err.message };
      fs.writeFileSync(longTaskFile(), JSON.stringify(longTaskState, null, 2));
    });
    return res.json({ ok: true, message: "Long task started. Poll this route (without ?start=1) every 30-60s.", state: longTaskState });
  }

  res.json({ ok: true, state: longTaskState || { status: "idle", hint: "call with ?start=1&token=... to start it" } });
});

module.exports = router;
