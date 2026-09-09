import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "./errors.js";
import {
  findMonorepoRoot,
  resolveSourcesRegistryPath,
} from "./paths.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

describe("findMonorepoRoot", () => {
  it("finds the radar-ia workspace root from this package", () => {
    const root = findMonorepoRoot();
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { name: string; workspaces?: unknown };
    expect(pkg.name).toBe("radar-ia");
    expect(pkg.workspaces).toBeDefined();
  });

  it("throws when no monorepo root exists above a temp dir", () => {
    const isolated = mkdtempSync(join(tmpdir(), "radar-ia-no-root-"));
    expect(() => findMonorepoRoot(isolated)).toThrow(ConfigurationError);
  });
});

describe("resolveSourcesRegistryPath", () => {
  it("keeps absolute paths unchanged", () => {
    const absolute = resolve("/tmp", "custom-sources.json");
    expect(resolveSourcesRegistryPath(absolute)).toBe(absolute);
  });

  it("resolves relative paths against the monorepo root, not cwd", () => {
    const root = findMonorepoRoot();
    const expected = resolve(root, "config/sources.json");

    // Simulate npm workspace launch: cwd = apps/bot
    const botDir = join(root, "apps", "bot");
    process.chdir(botDir);

    expect(resolveSourcesRegistryPath("config/sources.json")).toBe(expected);
    expect(resolveSourcesRegistryPath("config/sources.json")).not.toBe(
      resolve(botDir, "config/sources.json"),
    );
  });

  it("resolves against an injected monorepo root (worker workspace cwd)", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "radar-ia-root-"));
    writeFileSync(
      join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "radar-ia",
        workspaces: ["apps/*", "packages/*"],
      }),
    );
    mkdirSync(join(fixtureRoot, "config"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, "config", "sources.json"),
      '{"sources":[]}',
    );
    mkdirSync(join(fixtureRoot, "apps", "worker"), { recursive: true });

    process.chdir(join(fixtureRoot, "apps", "worker"));

    expect(
      resolveSourcesRegistryPath("config/sources.json", {
        monorepoRoot: fixtureRoot,
      }),
    ).toBe(resolve(fixtureRoot, "config/sources.json"));
  });
});
