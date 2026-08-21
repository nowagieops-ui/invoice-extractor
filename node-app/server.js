const app = require("./app");
const { PORT } = require("./src/config");
const jobStore = require("./src/services/jobStore");

// Any job still "running"/"starting" on disk died with whatever process
// instance was handling it before this boot - mark it as a truthful
// terminal error (not left hanging) and release the single-job lock.
jobStore.reconcileOrphanedJobs();

app.listen(PORT, () => {
  console.log(`invoice-extractor-node listening on port ${PORT}`);
});
