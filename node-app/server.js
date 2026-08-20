const app = require("./app");
const { PORT } = require("./src/config");

// On process boot, reconcile any orphaned "running" job state left behind
// by a previous process instance. Not needed yet in Phase 0 (no real jobs
// exist), but this is where Phase 2's restart-resilience check will live.

app.listen(PORT, () => {
  console.log(`invoice-extractor-node listening on port ${PORT}`);
});
