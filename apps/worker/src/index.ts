import { startWorker } from "./worker.js";

startWorker().catch((error: unknown) => {
  console.error("Failed to start pipeline worker:", error);
  process.exit(1);
});
