import { startServer } from "./server.js";

startServer().catch((error: unknown) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
