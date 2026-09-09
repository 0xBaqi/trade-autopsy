const ETHERSCAN_CHAIN_IDS = new Map([
  ["ethereum", "1"],
  ["bsc", "56"],
  ["polygon", "137"],
  ["arbitrum", "42161"],
  ["base", "8453"],
  ["optimism", "10"],
]);

function positiveHexValue(value) {
  try {
    return BigInt(value || "0x0") > 0n;
  } catch {
    return false;
  }
}

function positiveDecimalValue(value) {
  try {
    return BigInt(value || "0") > 0n;
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

async function etherscanInternalTransfers(chain, hash, timeoutMs = 3000) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  const chainId = ETHERSCAN_CHAIN_IDS.get(chain?.id);
  const diagnostics = {
    provider: "ETHERSCAN_V2",
    keyConfigured: Boolean(apiKey),
    chainId: chainId || null,
    outcome: null,
    httpStatus: null,
    apiStatus: null,
    apiMessage: null,
  };

  if (!apiKey) {
    diagnostics.outcome = "MISSING_API_KEY";
    return { transfers: null, diagnostics };
  }
  if (!chainId) {
    diagnostics.outcome = "UNSUPPORTED_CHAIN";
    return { transfers: null, diagnostics };
  }

  const params = new URLSearchParams({
    chainid: chainId,
    module: "account",
    action: "txlistinternal",
    txhash: hash,
    apikey: apiKey,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://api.etherscan.io/v2/api?${params.toString()}`, {
      signal: controller.signal,
    });
    diagnostics.httpStatus = res.status;
    if (!res.ok) {
      diagnostics.outcome = "HTTP_ERROR";
      return { transfers: null, diagnostics };
    }

    const json = await res.json();
    diagnostics.apiStatus = typeof json?.status === "string" ? json.status : null;
    diagnostics.apiMessage = typeof json?.message === "string" ? json.message.slice(0, 160) : null;

    if (json?.status !== "1" || !Array.isArray(json.result)) {
      diagnostics.outcome = "API_REJECTED";
      return { transfers: null, diagnostics };
    }

    const transfers = json.result
      .filter(
        (entry) =>
          entry?.isError === "0" &&
          typeof entry.from === "string" &&
          typeof entry.to === "string" &&
          positiveDecimalValue(entry.value)
      )
      .map((entry) => ({
        from: entry.from,
        to: entry.to,
        rawAmount: BigInt(entry.value).toString(),
        traceDepth: null,
      }));

    diagnostics.outcome = "SUCCESS";
    return { transfers, diagnostics };
  } catch (error) {
    diagnostics.outcome = error?.name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR";
    diagnostics.apiMessage = typeof error?.message === "string" ? error.message.slice(0, 160) : null;
    return { transfers: null, diagnostics };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Best-effort internal native-transfer evidence.
 *
 * Prefer node-native traces. If public RPCs do not expose tracing, optionally
 * use Etherscan V2's transaction-hash internal-transactions endpoint when an
 * ETHERSCAN_API_KEY is configured. Missing optional evidence never makes the
 * transaction analysis fail.
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
    return {
      available: true,
      source: "DEBUG_CALL_TRACER",
      transfers,
      diagnostics: { explorer: null },
    };
  }

  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await rpcTraceRequest(rpcUrl, "trace_transaction", [hash]);
    if (!trace) continue;
    return {
      available: true,
      source: "PARITY_TRACE_TRANSACTION",
      transfers: collectParityNativeTransfers(trace),
      diagnostics: { explorer: null },
    };
  }

  const explorerResult = await etherscanInternalTransfers(chain, hash);
  if (explorerResult.transfers) {
    return {
      available: true,
      source: "ETHERSCAN_INTERNAL_TRANSACTIONS",
      transfers: explorerResult.transfers,
      diagnostics: { explorer: explorerResult.diagnostics },
    };
  }

  return {
    available: false,
    source: null,
    transfers: [],
    diagnostics: { explorer: explorerResult.diagnostics },
  };
}
