import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, kvGet, kvSet, kvIncr, aiBudgetAllows, usingSharedStore, __resetGuardForTests, caseCacheKey } from "../lib/guard";

const req = (ip = "1.1.1.1") => new Request("http://x/api", { headers: { "x-forwarded-for": ip } });

beforeEach(() => { __resetGuardForTests(); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; delete process.env.AI_DAILY_CAP; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("rateLimit (in-memory backend)", () => {
  it("allows up to the limit then blocks with a positive retryAfter", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit(req(), "t", 3, 600)).allowed).toBe(true);
    const blocked = await rateLimit(req(), "t", 3, 600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(600);
  });
  it("tracks IPs and buckets independently", async () => {
    await rateLimit(req("2.2.2.2"), "a", 1, 600);
    expect((await rateLimit(req("2.2.2.2"), "a", 1, 600)).allowed).toBe(false);
    expect((await rateLimit(req("3.3.3.3"), "a", 1, 600)).allowed).toBe(true);
    expect((await rateLimit(req("2.2.2.2"), "b", 1, 600)).allowed).toBe(true);
  });
  it("resets in the next window", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await rateLimit(req(), "w", 1, 60);
    expect((await rateLimit(req(), "w", 1, 60)).allowed).toBe(false);
    vi.setSystemTime(new Date("2026-01-01T00:01:05Z"));
    expect((await rateLimit(req(), "w", 1, 60)).allowed).toBe(true);
  });
});

describe("cache", () => {
  it("round-trips values and expires them", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await kvSet("k", { a: 1 }, 10);
    expect(await kvGet("k")).toEqual({ a: 1 });
    vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
    expect(await kvGet("k")).toBeNull();
  });
  it("skips oversized values", async () => {
    expect(await kvSet("big", { s: "x".repeat(600_000) }, 10)).toBe(false);
    expect(await kvGet("big")).toBeNull();
  });
  it("keys are case-insensitive on the hash and versioned", () => {
    expect(caseCacheKey("base", "0xABC")).toBe(caseCacheKey("base", "0xabc"));
    expect(caseCacheKey("base", "0xabc")).toMatch(/^case:v\d+:base:0xabc$/);
  });
});

describe("daily AI budget", () => {
  it("allows calls up to AI_DAILY_CAP then refuses", async () => {
    process.env.AI_DAILY_CAP = "2";
    expect(await aiBudgetAllows()).toBe(true);
    expect(await aiBudgetAllows()).toBe(true);
    expect(await aiBudgetAllows()).toBe(false);
  });
  it("a cap of 0 disables AI", async () => {
    process.env.AI_DAILY_CAP = "0";
    expect(await aiBudgetAllows()).toBe(false);
  });
});

describe("Upstash backend", () => {
  it("is used when configured, and sets EXPIRE on the first INCR", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://u.example"; process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    expect(usingSharedStore()).toBe(true);
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, init) => { const cmd = JSON.parse(init.body); calls.push(cmd); return new Response(JSON.stringify({ result: cmd[0] === "INCR" ? 1 : 1 }), { status: 200 }); }));
    expect(await kvIncr("c", 60)).toBe(1);
    expect(calls.map((c) => c[0])).toEqual(["INCR", "EXPIRE"]);
  });
  it("falls back to memory (and still limits) when Upstash fails", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://u.example"; process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await rateLimit(req(), "f", 1, 600)).allowed).toBe(true);
    expect((await rateLimit(req(), "f", 1, 600)).allowed).toBe(false);
  });
});
