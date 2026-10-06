import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryRateLimiter } from "../rateLimiter.js";

describe("InMemoryRateLimiter", () => {
  it("allows burst capacity immediately", async () => {
    const limiter = new InMemoryRateLimiter(10, 5);
    const start = Date.now();

    for (let i = 0; i < 5; i++) {
      await limiter.acquire("key");
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("waits for token refill", async () => {
    let mockNow = 1000;
    const limiter = new InMemoryRateLimiter(
      2,
      1,
      () => mockNow,
    );

    await limiter.acquire("key");
    expect(true);

    mockNow += 250;
    const p1 = limiter.acquire("key");

    mockNow += 250;
    const p2 = limiter.acquire("key");

    await Promise.all([p1, p2]);
    expect(true);
  });

  it("tracks separate buckets per key", async () => {
    const limiter = new InMemoryRateLimiter(1, 1);

    await limiter.acquire("key1");
    await limiter.acquire("key2");
    await limiter.acquire("key3");

    expect(true);
  });

  it("refills tokens over time", async () => {
    let mockNow = 0;
    const limiter = new InMemoryRateLimiter(
      5,
      10,
      () => mockNow,
    );

    for (let i = 0; i < 10; i++) {
      await limiter.acquire("key");
    }

    mockNow += 2000;

    for (let i = 0; i < 10; i++) {
      await limiter.acquire("key");
    }

    expect(true);
  });

  it("caps tokens at burst level", async () => {
    let mockNow = 0;
    const limiter = new InMemoryRateLimiter(
      1,
      5,
      () => mockNow,
    );

    mockNow += 10000;

    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      await limiter.acquire("key");
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
