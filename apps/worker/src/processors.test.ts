import { Queues } from "@oms/core";
import { createTestDeps } from "@oms/core/testing";
import { authorizations, shops } from "@oms/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processors } from "./processors.js";

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeAll(async () => { t = await createTestDeps(); });
afterAll(async () => { await t.close(); });

describe("scheduler", () => {
  it("fans out one orderSync job per active shop", async () => {
    const exp = new Date("2030-01-01");
    await t.deps.db.insert(authorizations).values({
      id: "a1", sellerName: "s", sellerBaseRegion: "US", userType: 0,
      accessTokenEnc: "x", accessTokenExpiresAt: exp, refreshTokenEnc: "x", refreshTokenExpiresAt: exp,
    });
    await t.deps.db.insert(shops).values([
      { id: "s1", name: "A", region: "US", cipher: "c1", authorizationId: "a1" },
      { id: "s2", name: "B", region: "US", cipher: "c2", authorizationId: "a1", active: false },
    ]);
    await processors[Queues.scheduler](t.deps, { kind: "orders" });
    expect(t.queues.jobs.map((j) => [j.queue, j.data.shopId])).toEqual([[Queues.orderSync, "s1"]]);
  });
});
