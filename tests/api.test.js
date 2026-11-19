import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/chains", async (importOriginal) => ({
  ...(await importOriginal()),
  rpcTransactionBundle: vi.fn(async () => { throw new Error("rpc down"); }),
  rpcCall: vi.fn(async () => null),
}));

import { POST as analyze, GET as analyzeStatus } from "../app/api/analyze/route";
import { POST as detect } from "../app/api/detect/route";
import { GET as health } from "../app/api/health/route";
import { rpcTransactionBundle, rpcCall } from "../lib/chains";
import { __resetGuardForTests, kvSet, caseCacheKey } from "../lib/guard";

const HASH = "0x" + "a".repeat(64);
const post = (url, body, headers = {}) => new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => { __resetGuardForTests(); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; vi.clearAllMocks(); });

describe("POST /api/analyze", () => {
  it("rejects bad JSON, bad hash and unknown chain with 400", async () => {
    expect((await analyze(post("/api/analyze", "{nope"))).status).toBe(400);
    expect((await analyze(post("/api/analyze", { hash: "0x12", chainId: "ethereum" }))).status).toBe(400);
    expect((await analyze(post("/api/analyze", { hash: HASH, chainId: "nochain" }))).status).toBe(400);
  });

  it("an X-PAYMENT header does NOT bypass the rate limit (previous hole)", async () => {
    const send = () => analyze(post("/api/analyze", { hash: HASH, chainId: "ethereum" }, { "x-payment": "fake-token" }));
    for (let i = 0; i < 15; i++) expect((await send()).status).toBe(502);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(rpcTransactionBundle).toHaveBeenCalledTimes(15);
  });

  it("never returns 402 or payment headers", async () => {
    const res = await analyze(post("/api/analyze", { hash: HASH, chainId: "ethereum" }, { "x-payment": "x" }));
    expect(res.status).not.toBe(402);
    expect(res.headers.get("x-payment-response")).toBeNull();
    const status = await (await analyzeStatus()).json();
    expect(status.payment).toBeUndefined();
  });

  it("serves cached cases without touching RPC or the rate limit", async () => {
    await kvSet(caseCacheKey("ethereum", HASH), { caseData: { hash: HASH }, analysis: { verdict: "clean" } }, 60);
    for (let i = 0; i < 40; i++) {
      const res = await analyze(post("/api/analyze", { hash: HASH.toUpperCase().replace("0X", "0x"), chainId: "ethereum" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-cache")).toBe("HIT");
    }
    expect(rpcTransactionBundle).not.toHaveBeenCalled();
  });
});

describe("POST /api/detect", () => {
  it("rate limits uncached lookups per IP", async () => {
    for (let i = 0; i < 30; i++) expect((await detect(post("/api/detect", { hash: HASH }))).status).toBe(404);
    expect((await detect(post("/api/detect", { hash: HASH }))).status).toBe(429);
  });
});

describe("GET /api/health", () => {
  it("advertises no payment protocol", async () => {
    const res = await health();
    expect(res.headers.get("x-accepts-payment")).toBeNull();
    expect((await res.json()).payment).toBeUndefined();
  });
});
