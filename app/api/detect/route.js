import { NextResponse } from "next/server";
import { CHAINS, rpcCall, isValidTxHash } from "../../../lib/chains";
import { rateLimit, kvGet, kvSet, detectCacheKey, CACHE_TTL_FULL } from "../../../lib/guard";

const DETECT_LIMIT = 30;          // uncached detections per IP (each fans out to every supported chain)
const DETECT_WINDOW_SEC = 10 * 60;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const hash = (body?.hash || "").trim();
  if (!isValidTxHash(hash)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid transaction hash. It should start with 0x and be 66 characters long." },
      { status: 400 }
    );
  }

  const cacheKey = detectCacheKey(hash);
  const cached = await kvGet(cacheKey);
  if (Array.isArray(cached?.candidates) && cached.candidates.length > 0) return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });

  const { allowed, retryAfter } = await rateLimit(req, "detect", DETECT_LIMIT, DETECT_WINDOW_SEC);
  if (!allowed) return NextResponse.json({ error: "Too many lookups. Please wait before trying again.", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });

  const attempts = CHAINS.map(async (chain) => {
    try {
      const tx = await rpcCall(chain, "eth_getTransactionByHash", [hash]);
      return tx ? { chainId: chain.id, chainName: chain.name, symbol: chain.symbol } : null;
    } catch (e) {
      return { chainId: chain.id, chainName: chain.name, error: e.message };
    }
  });

  const results = await Promise.all(attempts);
  const candidates = results.filter((r) => r && !r.error);
  const failures = results.filter((r) => r && r.error);

  if (candidates.length === 0) {
    if (failures.length === CHAINS.length) {
      return NextResponse.json(
        { error: "Couldn't reach any chain's RPC right now. Try again in a moment.", candidates: [] },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "No transaction found with that hash on any supported chain. Double-check the hash.", candidates: [] },
      { status: 404 }
    );
  }

  // Only cache when every chain answered, so a transient RPC failure is never remembered as "not on that chain".
  if (failures.length === 0) await kvSet(cacheKey, { candidates }, CACHE_TTL_FULL);
  return NextResponse.json({ candidates });
}
