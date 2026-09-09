/**
 * Resolve the Prisma CLI via Node module resolution (workspace-hoist safe)
 * and forward argv (generate / validate / migrate …).
 *
 * Usage (from packages/database):
 *   node --env-file=../../.env ./scripts/run-prisma.mjs generate
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const prismaPackageJson = require.resolve("prisma/package.json");
const prismaCli = join(dirname(prismaPackageJson), "build", "index.js");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: run-prisma.mjs <prisma-args…>");
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
