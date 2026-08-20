# invoice-extractor-node — Phase 0

This is **not** the rewritten app yet. It's a minimal smoke test to verify
Hostinger's Node.js Selector environment can actually support the real
rewrite before real implementation time goes into it. See the full plan
this is part of for context: `polymorphic-knitting-starlight.md` (ask
Claude for it if you don't have the path handy).

## What this checks

1. **`GET /health`** — confirms the app boots under Passenger at all, and
   tells you which Node version Hostinger is running.
2. **`GET /debug/imap-check?token=...`** — opens a raw TLS connection to
   `imap.gmail.com:993` (no login). This is the single highest-risk
   unknown in the whole rewrite: shared hosts often block non-HTTP
   outbound ports. If this fails, stop and reconsider before building
   anything else.
3. **`GET /debug/gemini-check?token=...`** — makes one trivial Gemini call.
   Confirms outbound HTTPS to Google's API works and `GEMINI_API_KEY` is
   readable.
4. **`GET /debug/disk-check?token=...`** — writes a counter to disk, reads
   it back. Call it once, redeploy the app from hPanel, call it again — if
   the count kept incrementing, the data directory survives a redeploy.
5. **`GET /debug/long-task?token=...&start=1`** to kick off a 10-minute
   background task, then **`GET /debug/long-task?token=...`** (repeatedly,
   every 30-60s, for ~10 minutes) to watch `ticks` increase. This proves a
   background async job can outlive whatever request/idle-timeout policy
   Passenger enforces — the entire fix for the "scan times out" problem
   depends on this being true.

## Setup on Hostinger

1. In hPanel → your domain → Node.js Selector (or "Deploy Web App" →
   Node.js), point it at this `node-app/` folder.
2. Set environment variables in that UI (not a committed `.env` file):
   - `GEMINI_API_KEY` — your real key.
   - `DEBUG_TOKEN` — any random string you make up, just needs to match
     what you put in the `?token=` query param when you hit the routes.
3. Run/trigger `npm install` (automatic or manual button, depending on
   what hPanel offers — note which one it is, it matters for later
   phases too).
4. Confirm the "Application startup file" is set to `server.js`, and note
   whatever convention hPanel uses for the port — this app reads
   `process.env.PORT` with a fallback to 3000.
5. Start/restart the app, then hit the URLs above in order.

## What to report back

For each of the 5 checks: pass/fail, and the exact JSON response (or error
page) you got. Also note anywhere hPanel's actual UI didn't match what
this README assumed (env var location, startup file field, npm install
trigger) — those assumptions get locked in for the real Phase 1 build
once this passes.

## Local dev (optional, just to sanity-check the code runs before deploying)

```
cp .env.example .env    # fill in GEMINI_API_KEY and DEBUG_TOKEN
npm install
npm start
```
