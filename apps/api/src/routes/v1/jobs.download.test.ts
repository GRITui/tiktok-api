import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDeps } from "@oms/core/testing";
import { jobs } from "@oms/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

let t: Awaited<ReturnType<typeof createTestDeps>>;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "oms-files-"));
  t = await createTestDeps({ fileStorageDir: dir });
});
afterAll(async () => { await t.close(); });

const ops = { id: "u1", email: "ops@x.y", name: null, role: "ops" as const };

describe("GET /v1/jobs/:id/download", () => {
  it("serves the label PDF recorded on the job", async () => {
    await mkdir(join(dir, "labels"), { recursive: true });
    const filePath = join(dir, "labels", "j1.pdf");
    await writeFile(filePath, "%PDF-1.7 test");
    const [job] = await t.deps.db.insert(jobs).values({
      type: "labels", status: "succeeded", result: { filePath, contentType: "application/pdf" },
    }).returning();
    const app = await buildApp({ deps: t.deps, logger: false, testUser: ops });
    const res = await app.inject({ method: "GET", url: `/v1/jobs/${job!.id}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.startsWith("%PDF")).toBe(true);
  });

  it("refuses files outside the storage directory", async () => {
    const [job] = await t.deps.db.insert(jobs).values({
      type: "labels", status: "succeeded", result: { filePath: "/etc/passwd" },
    }).returning();
    const app = await buildApp({ deps: t.deps, logger: false, testUser: ops });
    const res = await app.inject({ method: "GET", url: `/v1/jobs/${job!.id}/download` });
    expect(res.statusCode).toBe(404);
  });
});
