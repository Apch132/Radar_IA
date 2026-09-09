import { describe, expect, it } from "vitest";

import {
  canonicalizeAggregateFingerprint,
  computeAggregateFingerprint,
} from "./aggregate-fingerprint.js";

describe("aggregate fingerprint", () => {
  const base = {
    folderId: "folder-1",
    articleIds: ["a2", "a1"],
    enrichmentFacts: [
      { key: "version", value: "2.0" },
      { key: "date", value: "2026-07-01" },
    ],
    folderStatus: "open" as const,
  };

  it("1. is deterministic", () => {
    const a = computeAggregateFingerprint(base);
    const b = computeAggregateFingerprint(base);
    expect(a).toBe(b);
  });

  it("2. ignores article order", () => {
    const left = computeAggregateFingerprint(base);
    const right = computeAggregateFingerprint({
      ...base,
      articleIds: ["a1", "a2"],
    });
    expect(left).toBe(right);
  });

  it("3. ignores fact order", () => {
    const left = computeAggregateFingerprint(base);
    const right = computeAggregateFingerprint({
      ...base,
      enrichmentFacts: [
        { key: "date", value: "2026-07-01" },
        { key: "version", value: "2.0" },
      ],
    });
    expect(left).toBe(right);
  });

  it("4. changes when an article changes", () => {
    const left = computeAggregateFingerprint(base);
    const right = computeAggregateFingerprint({
      ...base,
      articleIds: ["a1", "a3"],
    });
    expect(left).not.toBe(right);
  });

  it("5. changes when a fact changes", () => {
    const left = computeAggregateFingerprint(base);
    const right = computeAggregateFingerprint({
      ...base,
      enrichmentFacts: [
        { key: "version", value: "2.1" },
        { key: "date", value: "2026-07-01" },
      ],
    });
    expect(left).not.toBe(right);
  });

  it("6. changes when folder status changes", () => {
    const left = computeAggregateFingerprint(base);
    const right = computeAggregateFingerprint({
      ...base,
      folderStatus: "closed",
    });
    expect(left).not.toBe(right);
  });

  it("7. returns SHA-256 hex lowercase (64 chars)", () => {
    const fp = computeAggregateFingerprint(base);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalizeAggregateFingerprint(base)).toContain("folderId=folder-1");
    expect(canonicalizeAggregateFingerprint(base)).toContain("articles=a1,a2");
  });
});
