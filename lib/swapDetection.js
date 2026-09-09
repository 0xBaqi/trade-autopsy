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

// Common Uniswap/Pancake V3 SwapRouter selectors. Selector evidence alone is
// intentionally insufficient: sender-visible distinct asset flows are required.
const V3_SWAP_SELECTORS = new Map([
  ["0x414bf389", "exactInputSingle"],
  ["0xc04b8d59", "exactInput"],
  ["0xdb3e2198", "exactOutputSingle"],
  ["0xf28c0498", "exactOutput"],
  // SwapRouter02 tuple variants used by newer router deployments.
  ["0x04e45aaf", "exactInputSingle"],
  ["0xb858183f", "exactInput"],
  ["0x5023b4df", "exactOutputSingle"],
  ["0x09b81346", "exactOutput"],
]);

const PANCAKE_UNIVERSAL_ROUTERS = new Set([
  "0x1a0a18ac4becddbd6389559687d1a73d8927e416",
  "0xd9c500dff816a1da21a48a732d3498bf09dc9aeb",
]);

const UNIVERSAL_ROUTER_EXECUTE_SELECTORS = new Set([
  "0x3593564c",
  "0x24856bc3",
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
 * A recognized swap-shaped call is never enough on its own. A successful receipt
 * plus sender-visible evidence of a different asset leaving and entering is always
 * required. This keeps V3 support additive without inventing route/protocol details.
 */
export function detectSwapClassification({ tx, receipt, assetFlows }) {
  if (receipt?.status !== "0x1") return null;

  const selector = selectorOf(tx?.input);
  if (!selector) return null;

  const v2Method = V2_SWAP_SELECTORS.get(selector) || null;
  const v3Method = V3_SWAP_SELECTORS.get(selector) || null;
  const universalMethod = universalRouterMethod(tx, selector);
  const method = v2Method || v3Method || universalMethod;
  if (!method) return null;

  const assetsOut = Array.isArray(assetFlows?.assetsOut) ? assetFlows.assetsOut : [];
  const assetsIn = Array.isArray(assetFlows?.assetsIn) ? assetFlows.assetsIn : [];
  if (!hasDistinctAssets(assetsOut, assetsIn)) return null;

  const isUniversalRouter = Boolean(universalMethod);
  const routerType = isUniversalRouter ? "PANCAKE_UNIVERSAL_ROUTER" : v3Method ? "V3_STYLE" : "V2_STYLE";
  const reason = isUniversalRouter
    ? "The call targets a verified PancakeSwap Universal Router and sender-side evidence shows one asset leaving while a different asset enters."
    : v3Method
      ? "The call matches a known V3-style swap function and sender-side evidence shows one asset leaving while a different asset enters."
      : "The call matches a known swap function and the sender-side evidence shows one asset leaving while a different asset enters.";

  return {
    type: "SWAP",
    confidence: "MEDIUM",
    reason,
    swap: {
      selector,
      method,
      routerType,
      assetsOut,
      assetsIn,
      coverage: assetFlows?.coverage || null,
    },
  };
}
