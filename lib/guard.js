// lib/guard.js
// Cost protection for the public API: result cache, per-IP rate limit, daily AI budget.
//
// Backend: Upstash Redis (REST) when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set,
// shared across all serverless instances. Otherwise an in-memory Map is used. The in-memory
// fallback is per-instance on Vercel, so it is BEST-EFFORT only and is not a hard guarantee.
// If Upstash is configured but a call fails, that call falls back to memory and logs the error.

const mem = new Map(); // key -> { value: string, expiresAt: number }
const MEM_MAX_KEYS = 2000;
const MAX_VALUE_CHARS = 500_000;

export function usingSharedStore() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { ok: false };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(String(json.error));
    return { ok: true, result: json?.result };
  } catch (e) {
    console.error("[guard] Upstash call failed, using in-memory fallback:", e?.message || e);
    return { ok: false };
  }
}

function memPrune(now) {
  if (mem.size < MEM_MAX_KEYS) return;
  for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
  while (mem.size >= MEM_MAX_KEYS) mem.delete(mem.keys().next().value);
}
function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { mem.delete(key); return null; }
  return entry.value;
}
function memSet(key, value, ttlSec) {
  const now = Date.now();
  memPrune(now);
  mem.set(key, { value, expiresAt: now + ttlSec * 1000 });
}

export async function kvGet(key) {
  const r = await redis(["GET", key]);
  const raw = r.ok ? r.result : memGet(key);
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function kvSet(key, value, ttlSec) {
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_VALUE_CHARS) return false;
  const r = await redis(["SET", key, serialized, "EX", String(ttlSec)]);
  if (!r.ok) memSet(key, serialized, ttlSec);
  return true;
}

export async function kvIncr(key, ttlSec) {
  const r = await redis(["INCR", key]);
  if (r.ok && Number.isFinite(Number(r.result))) {
    const count = Number(r.result);
    if (count === 1) await redis(["EXPIRE", key, String(ttlSec)]);
    return count;
  }
  const current = Number(memGet(key) || 0) + 1;
  const entry = mem.get(key);
  // Preserve the original window expiry when incrementing an existing counter.
  if (entry && entry.expiresAt > Date.now()) mem.set(key, { value: String(current), expiresAt: entry.expiresAt });
  else memSet(key, String(current), ttlSec);
  return current;
}

/** Client IP. On Vercel, x-forwarded-for is set by the platform edge. */
export function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/** Fixed-window per-IP limit. Returns { allowed, retryAfter } (retryAfter in seconds). */
export async function rateLimit(request, bucket, limit, windowSec) {
  const ip = getClientIp(request);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(nowSec / windowSec);
  const count = await kvIncr(`rl:${bucket}:${ip}:${windowIndex}`, windowSec);
  if (count <= limit) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, (windowIndex + 1) * windowSec - nowSec) };
}

/** Daily cap on paid AI calls. Past the cap the deterministic explanation is served instead. */
export async function aiBudgetAllows() {
  const cap = Number.parseInt(process.env.AI_DAILY_CAP ?? "300", 10);
  if (!Number.isFinite(cap) || cap < 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  const count = await kvIncr(`ai:${day}`, 90_000);
  return count <= cap;
}

// Cache keys carry a version; bump it whenever classification or evidence logic changes.
export const CASE_CACHE_VERSION = "v1";
export const caseCacheKey = (chainId, hash) => `case:${CASE_CACHE_VERSION}:${chainId}:${hash.toLowerCase()}`;
export const detectCacheKey = (hash) => `detect:${CASE_CACHE_VERSION}:${hash.toLowerCase()}`;
export const CACHE_TTL_FULL = 6 * 60 * 60;   // 6h: result includes the AI explanation (or none is configured)
export const CACHE_TTL_SHORT = 10 * 60;      // 10m: deterministic fallback, so a later request can get the AI version

export function __resetGuardForTests() { mem.clear(); }
