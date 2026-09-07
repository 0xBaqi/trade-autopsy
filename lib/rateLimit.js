// lib/rateLimit.js
// Simple in-memory rate limiter for the free MVP tier.
//
// IMPORTANT LIMITATION: This store is per-serverless-instance.
// Vercel may run multiple concurrent instances with no shared memory.
// This provides best-effort protection against casual/accidental abuse
// but is NOT a hard enforcement guarantee. A durable store (Redis/Upstash)
// is required for production-grade enforcement.

const FREE_TIER_LIMIT = 5;        // max free analyses
const WINDOW_MS = 10 * 60 * 1000; // per 10-minute window

// Map<ip: string, { count: number, windowStart: number }>
const store = new Map();

/**
 * Check and record a free-tier request from the given IP.
 * Returns { allowed: boolean, retryAfter: number } where retryAfter
 * is seconds until the window resets (only meaningful when allowed is false).
 */
export function checkFreeTierLimit(ip) {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // First request in a new window — reset.
    store.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count < FREE_TIER_LIMIT) {
    entry.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  // Limit exceeded.
  const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
  return { allowed: false, retryAfter };
}

/**
 * Extract the best available IP from a Next.js App Router Request.
 * x-forwarded-for is set by Vercel's edge infrastructure.
 */
export function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
