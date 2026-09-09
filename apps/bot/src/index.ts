import { startBot } from "./bot.js";

startBot().catch((error: unknown) => {
  console.error("Failed to start Discord bot:", error);
  process.exit(1);
});
