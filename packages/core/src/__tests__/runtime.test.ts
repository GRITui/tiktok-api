import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "../runtime.js";

describe("findRepoRoot", () => {
  it("finds the workspace root from a nested package dir", () => {
    const root = mkdtempSync(join(tmpdir(), "oms-root-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "apps", "worker");
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
  });
});
