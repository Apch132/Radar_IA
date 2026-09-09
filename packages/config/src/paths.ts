import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { configurationErrorFromMessage } from "./errors.js";

/**
 * Locate the monorepo root by walking parents for `package.json`
 * with `name: "radar-ia"` and a `workspaces` field.
 */
export function findMonorepoRoot(
  fromDir: string = dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = resolve(fromDir);
  for (;;) {
    const pkgFile = join(dir, "package.json");
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
          name?: unknown;
          workspaces?: unknown;
        };
        if (pkg.name === "radar-ia" && pkg.workspaces !== undefined) {
          return dir;
        }
      } catch {
        // Continue walking if package.json is unreadable / invalid.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw configurationErrorFromMessage(
    ["SOURCES_REGISTRY_PATH"],
    "Unable to locate Radar IA monorepo root (expected package.json name=radar-ia with workspaces).",
  );
}

/**
 * Resolve `SOURCES_REGISTRY_PATH` against the monorepo root when relative.
 * Absolute paths are returned unchanged — never depends on `process.cwd()`.
 */
export function resolveSourcesRegistryPath(
  configuredPath: string,
  options?: { readonly monorepoRoot?: string },
): string {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }
  const root = options?.monorepoRoot ?? findMonorepoRoot();
  return resolve(root, configuredPath);
}
