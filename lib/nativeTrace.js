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

function collectParityNativeTransfers(entries) {
  const transfers = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const action = entry?.action;
    // trace_transaction includes the root call at traceAddress=[]; exclude it
    // because top-level tx.value is reconstructed separately.
    if (
      entry?.type === "call" &&
      Array.isArray(entry.traceAddress) &&
      entry.traceAddress.length > 0 &&
      !entry.error &&
      typeof action?.from === "string" &&
      typeof action?.to === "string" &&
      positiveHexValue(action?.value)
    ) {
      transfers.push({
        from: action.from,
        to: action.to,
        rawAmount: BigInt(action.value).toString(),
        traceDepth: entry.traceAddress.length,
      });
    }
  }
  return transfers;
}

async function rpcTraceRequest(rpcUrl, method, params, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || json?.result == null) return null;
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
 * Providers expose tracing through different namespaces. Prefer Geth's
 * debug_traceTransaction/callTracer, then try the parity-style
 * trace_transaction method. Failure remains missing optional evidence and must
 * never make the transaction analysis itself fail.
 */
export async function traceNativeTransfers(chain, hash) {
  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await rpcTraceRequest(rpcUrl, "debug_traceTransaction", [
      hash,
      { tracer: "callTracer", timeout: "2s" },
    ]);
    if (!trace) continue;

    const transfers = [];
    collectNestedNativeTransfers(trace, 0, transfers);
    return { available: true, source: "DEBUG_CALL_TRACER", transfers };
  }

  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await rpcTraceRequest(rpcUrl, "trace_transaction", [hash]);
    if (!trace) continue;
    return {
      available: true,
      source: "PARITY_TRACE_TRANSACTION",
      transfers: collectParityNativeTransfers(trace),
    };
  }

  return { available: false, source: null, transfers: [] };
}
