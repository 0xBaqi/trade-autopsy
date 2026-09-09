function positiveHexValue(value) {
  try {
    return BigInt(value || "0x0") > 0n;
  } catch {
    return false;
  }
}

function collectNestedNativeTransfers(frame, depth, transfers) {
  if (!frame || typeof frame !== "object") return;

  if (
    depth > 0 &&
    !frame.error &&
    typeof frame.from === "string" &&
    typeof frame.to === "string" &&
    positiveHexValue(frame.value)
  ) {
    transfers.push({
      from: frame.from,
      to: frame.to,
      rawAmount: BigInt(frame.value).toString(),
      traceDepth: depth,
    });
  }

  for (const child of Array.isArray(frame.calls) ? frame.calls : []) {
    collectNestedNativeTransfers(child, depth + 1, transfers);
  }
}

async function traceAtRpc(rpcUrl, hash, timeoutMs = 1800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "debug_traceTransaction",
        params: [hash, { tracer: "callTracer", timeout: "2s" }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || !json?.result) return null;
    return json.result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Best-effort internal native-transfer evidence.
 *
 * Public RPCs differ widely in debug_traceTransaction support. Failure to trace
 * is therefore treated as missing optional evidence, never as transaction
 * failure. The root call is excluded because top-level tx.value is already
 * reconstructed separately by assetFlows.
 */
export async function traceNativeTransfers(chain, hash) {
  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await traceAtRpc(rpcUrl, hash);
    if (!trace) continue;

    const transfers = [];
    collectNestedNativeTransfers(trace, 0, transfers);
    return {
      available: true,
      source: "DEBUG_CALL_TRACER",
      transfers,
    };
  }

  return {
    available: false,
    source: null,
    transfers: [],
  };
}
