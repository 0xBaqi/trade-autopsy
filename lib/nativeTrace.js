const ETHERSCAN_CHAIN_IDS = new Map([
  ["ethereum", "1"],
  ["bsc", "56"],
  ["polygon", "137"],
  ["arbitrum", "42161"],
  ["base", "8453"],
  ["optimism", "10"],
]);

const BSC_PANCAKE_V2_ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const BSC_WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const NATIVE_OUTPUT_V2_SELECTORS = new Set(["0x18cbafe5", "0x4a25d94a", "0x791ac947"]);
// keccak256("Withdrawal(address,uint256)")
const WITHDRAWAL_TOPIC = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95e7c2141b0";

function positiveHexValue(value) {
  try { return BigInt(value || "0x0") > 0n; } catch { return false; }
}
function positiveDecimalValue(value) {
  try { return BigInt(value || "0") > 0n; } catch { return false; }
}
function word(input, index) {
  const start = 10 + index * 64;
  const value = typeof input === "string" ? input.slice(start, start + 64) : "";
  return value.length === 64 ? value : null;
}
function addressFromWord(value) {
  return value && /^[0-9a-fA-F]{64}$/.test(value) ? `0x${value.slice(-40)}`.toLowerCase() : null;
}

// Strict, bounded proof for PancakeSwap V2 token -> BNB swaps on BSC.
// The router call must pay the transaction sender, its path must end in canonical
// WBNB, and canonical WBNB must emit Withdrawal(router, amount). Under the
// verified V2 router semantics that withdrawal is immediately paid to `to`.
function pancakeV2NativeOutputEvidence(chain, tx, receipt) {
  if (chain?.id !== "bsc" || receipt?.status !== "0x1") return null;
  const target = typeof tx?.to === "string" ? tx.to.toLowerCase() : null;
  const sender = typeof tx?.from === "string" ? tx.from.toLowerCase() : null;
  const input = tx?.input;
  const selector = typeof input === "string" && input.length >= 10 ? input.slice(0, 10).toLowerCase() : null;
  if (target !== BSC_PANCAKE_V2_ROUTER || !sender || !NATIVE_OUTPUT_V2_SELECTORS.has(selector)) return null;

  // All three supported router methods have path at ABI arg 2 and recipient at arg 3.
  const recipient = addressFromWord(word(input, 3));
  const pathOffsetWord = word(input, 2);
  if (recipient !== sender || !pathOffsetWord) return null;

  let pathOffset;
  try { pathOffset = Number(BigInt(`0x${pathOffsetWord}`)); } catch { return null; }
  if (!Number.isSafeInteger(pathOffset) || pathOffset < 0) return null;
  const argsHexStart = 10;
  const pathStart = argsHexStart + pathOffset * 2;
  const lengthHex = input.slice(pathStart, pathStart + 64);
  if (!/^[0-9a-fA-F]{64}$/.test(lengthHex)) return null;
  let pathLength;
  try { pathLength = Number(BigInt(`0x${lengthHex}`)); } catch { return null; }
  if (!Number.isSafeInteger(pathLength) || pathLength < 2 || pathLength > 32) return null;
  const lastPathWordStart = pathStart + 64 + (pathLength - 1) * 64;
  const lastPathToken = addressFromWord(input.slice(lastPathWordStart, lastPathWordStart + 64));
  if (lastPathToken !== BSC_WBNB) return null;

  const routerTopic = `0x${"0".repeat(24)}${BSC_PANCAKE_V2_ROUTER.slice(2)}`;
  const withdrawals = (receipt.logs || []).filter((log) =>
    typeof log?.address === "string" && log.address.toLowerCase() === BSC_WBNB &&
    Array.isArray(log.topics) && log.topics.length >= 2 &&
    log.topics[0]?.toLowerCase() === WITHDRAWAL_TOPIC &&
    log.topics[1]?.toLowerCase() === routerTopic &&
    /^0x[0-9a-fA-F]{64}$/.test(log.data || "") && positiveHexValue(log.data)
  );
  if (withdrawals.length !== 1) return null;

  return {
    available: true,
    source: "PANCAKE_V2_WBNB_WITHDRAWAL_PROOF",
    transfers: [{
      from: BSC_PANCAKE_V2_ROUTER,
      to: sender,
      rawAmount: BigInt(withdrawals[0].data).toString(),
      traceDepth: null,
    }],
    diagnostics: { explorer: null, protocolProof: "PANCAKE_V2_WBNB_WITHDRAWAL" },
  };
}

function collectNestedNativeTransfers(frame, depth, transfers) {
  if (!frame || typeof frame !== "object") return;
  if (depth > 0 && !frame.error && typeof frame.from === "string" && typeof frame.to === "string" && positiveHexValue(frame.value)) {
    transfers.push({ from: frame.from, to: frame.to, rawAmount: BigInt(frame.value).toString(), traceDepth: depth });
  }
  for (const child of Array.isArray(frame.calls) ? frame.calls : []) collectNestedNativeTransfers(child, depth + 1, transfers);
}

function collectParityNativeTransfers(entries) {
  const transfers = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const action = entry?.action;
    if (entry?.type === "call" && Array.isArray(entry.traceAddress) && entry.traceAddress.length > 0 && !entry.error && typeof action?.from === "string" && typeof action?.to === "string" && positiveHexValue(action?.value)) {
      transfers.push({ from: action.from, to: action.to, rawAmount: BigInt(action.value).toString(), traceDepth: entry.traceAddress.length });
    }
  }
  return transfers;
}

async function rpcTraceRequest(rpcUrl, method, params, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || json?.result == null) return null;
    return json.result;
  } catch { return null; } finally { clearTimeout(timeout); }
}

async function etherscanInternalTransfers(chain, hash, timeoutMs = 3000) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  const chainId = ETHERSCAN_CHAIN_IDS.get(chain?.id);
  const diagnostics = {
    provider: "ETHERSCAN_V2", keyConfigured: Boolean(apiKey), chainId: chainId || null,
    outcome: null, httpStatus: null, apiStatus: null, apiMessage: null, apiResult: null,
    runtime: { vercelEnv: process.env.VERCEL_ENV || null, vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
      matchingEnvNames: Object.keys(process.env).filter((name) => name.toUpperCase().includes("ETHERSCAN")).sort() },
  };
  if (!apiKey) { diagnostics.outcome = "MISSING_API_KEY"; return { transfers: null, diagnostics }; }
  if (!chainId) { diagnostics.outcome = "UNSUPPORTED_CHAIN"; return { transfers: null, diagnostics }; }

  const params = new URLSearchParams({ chainid: chainId, module: "account", action: "txlistinternal", txhash: hash, apikey: apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.etherscan.io/v2/api?${params.toString()}`, { signal: controller.signal });
    diagnostics.httpStatus = res.status;
    if (!res.ok) { diagnostics.outcome = "HTTP_ERROR"; return { transfers: null, diagnostics }; }
    const json = await res.json();
    diagnostics.apiStatus = typeof json?.status === "string" ? json.status : null;
    diagnostics.apiMessage = typeof json?.message === "string" ? json.message.slice(0, 160) : null;
    diagnostics.apiResult = typeof json?.result === "string" ? json.result.slice(0, 160) : null;
    if (json?.status !== "1" || !Array.isArray(json.result)) { diagnostics.outcome = "API_REJECTED"; return { transfers: null, diagnostics }; }
    const transfers = json.result.filter((entry) => entry?.isError === "0" && typeof entry.from === "string" && typeof entry.to === "string" && positiveDecimalValue(entry.value))
      .map((entry) => ({ from: entry.from, to: entry.to, rawAmount: BigInt(entry.value).toString(), traceDepth: null }));
    diagnostics.outcome = "SUCCESS";
    return { transfers, diagnostics };
  } catch (error) {
    diagnostics.outcome = error?.name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR";
    diagnostics.apiMessage = typeof error?.message === "string" ? error.message.slice(0, 160) : null;
    return { transfers: null, diagnostics };
  } finally { clearTimeout(timeout); }
}

/** Best-effort internal native-transfer evidence. Missing optional evidence never fails analysis. */
export async function traceNativeTransfers(chain, hash, tx = null, receipt = null) {
  // Cheap deterministic proof first for the bounded BSC PancakeSwap V2 native-output case.
  const protocolProof = pancakeV2NativeOutputEvidence(chain, tx, receipt);
  if (protocolProof) return protocolProof;

  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await rpcTraceRequest(rpcUrl, "debug_traceTransaction", [hash, { tracer: "callTracer", timeout: "2s" }]);
    if (!trace) continue;
    const transfers = [];
    collectNestedNativeTransfers(trace, 0, transfers);
    return { available: true, source: "DEBUG_CALL_TRACER", transfers, diagnostics: { explorer: null } };
  }
  for (const rpcUrl of chain?.rpcs || []) {
    const trace = await rpcTraceRequest(rpcUrl, "trace_transaction", [hash]);
    if (!trace) continue;
    return { available: true, source: "PARITY_TRACE_TRANSACTION", transfers: collectParityNativeTransfers(trace), diagnostics: { explorer: null } };
  }
  const explorerResult = await etherscanInternalTransfers(chain, hash);
  if (explorerResult.transfers) return { available: true, source: "ETHERSCAN_INTERNAL_TRANSACTIONS", transfers: explorerResult.transfers, diagnostics: { explorer: explorerResult.diagnostics } };
  return { available: false, source: null, transfers: [], diagnostics: { explorer: explorerResult.diagnostics } };
}
