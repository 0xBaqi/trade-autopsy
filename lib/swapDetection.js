const V2_SWAP_SELECTORS = new Map([
  ["0x38ed1739", "swapExactTokensForTokens"],
  ["0x8803dbee", "swapTokensForExactTokens"],
  ["0x7ff36ab5", "swapExactETHForTokens"],
  ["0x4a25d94a", "swapTokensForExactETH"],
  ["0x18cbafe5", "swapExactTokensForETH"],
  ["0xfb3bdb41", "swapETHForExactTokens"],
  ["0x5c11d795", "swapExactTokensForTokensSupportingFeeOnTransferTokens"],
  ["0xb6f9de95", "swapExactETHForTokensSupportingFeeOnTransferTokens"],
  ["0x791ac947", "swapExactTokensForETHSupportingFeeOnTransferTokens"],
]);

// PancakeSwap publishes these Universal Router addresses. Restricting execute()
// recognition to verified router addresses avoids treating an arbitrary contract
// with the same selector as swap evidence.
const PANCAKE_UNIVERSAL_ROUTERS = new Set([
  "0x1a0a18ac4becddbd6389559687d1a73d8927e416", // BSC v3 Universal Router
  "0xd9c500dff816a1da21a48a732d3498bf09dc9aeb", // BSC/Base Infinity Universal Router
]);

const UNIVERSAL_ROUTER_EXECUTE_SELECTORS = new Set([
  "0x3593564c", // execute(bytes,bytes[],uint256)
  "0x24856bc3", // execute(bytes,bytes[])
]);

function selectorOf(input) {
  if (typeof input !== "string" || input.length < 10) return null;
  return input.slice(0, 10).toLowerCase();
}

function assetKey(asset) {
  if (asset?.assetType === "NATIVE") return "native";
  if (asset?.assetType === "ERC20" && typeof asset.tokenAddress === "string") {
    return `token:${asset.tokenAddress.toLowerCase()}`;
  }
  return null;
}

function hasDistinctAssets(assetsOut, assetsIn) {
  const outgoing = new Set((assetsOut || []).map(assetKey).filter(Boolean));
  const incoming = new Set((assetsIn || []).map(assetKey).filter(Boolean));
  if (outgoing.size === 0 || incoming.size === 0) return false;
  for (const key of outgoing) if (!incoming.has(key)) return true;
  for (const key of incoming) if (!outgoing.has(key)) return true;
  return false;
}

function universalRouterMethod(tx, selector) {
  const target = typeof tx?.to === "string" ? tx.to.toLowerCase() : null;
  if (!target || !PANCAKE_UNIVERSAL_ROUTERS.has(target)) return null;
  if (!UNIVERSAL_ROUTER_EXECUTE_SELECTORS.has(selector)) return null;
  return "UniversalRouter.execute";
}

/**
 * Detect swap evidence conservatively.
 *
 * Supported evidence paths:
 * 1. known V2-style swap selector + distinct sender-side asset flows, or
 * 2. verified PancakeSwap Universal Router execute call + distinct sender-side
 *    asset flows.
 *
 * The Universal Router can compose many actions, so this does not claim every
 * internal command was a swap. It only reconstructs the sender-visible exchange
 * when a different asset leaves and enters during the successful router call.
 */
export function detectSwapClassification({ tx, receipt, assetFlows }) {
  if (receipt?.status !== "0x1") return null;

  const selector = selectorOf(tx?.input);
  if (!selector) return null;

  const v2Method = V2_SWAP_SELECTORS.get(selector) || null;
  const universalMethod = universalRouterMethod(tx, selector);
  const method = v2Method || universalMethod;
  if (!method) return null;

  const assetsOut = Array.isArray(assetFlows?.assetsOut) ? assetFlows.assetsOut : [];
  const assetsIn = Array.isArray(assetFlows?.assetsIn) ? assetFlows.assetsIn : [];
  if (!hasDistinctAssets(assetsOut, assetsIn)) return null;

  const isUniversalRouter = Boolean(universalMethod);
  return {
    type: "SWAP",
    confidence: "MEDIUM",
    reason: isUniversalRouter
      ? "The call targets a verified PancakeSwap Universal Router and sender-side evidence shows one asset leaving while a different asset enters."
      : "The call matches a known swap function and the sender-side evidence shows one asset leaving while a different asset enters.",
    swap: {
      selector,
      method,
      routerType: isUniversalRouter ? "PANCAKE_UNIVERSAL_ROUTER" : "V2_STYLE",
      assetsOut,
      assetsIn,
      coverage: assetFlows?.coverage || null,
    },
  };
}
