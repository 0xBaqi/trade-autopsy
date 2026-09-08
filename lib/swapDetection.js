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

  for (const key of outgoing) {
    if (!incoming.has(key)) return true;
  }
  for (const key of incoming) {
    if (!outgoing.has(key)) return true;
  }
  return false;
}

/**
 * Detect first-pass swap evidence conservatively.
 *
 * P2H deliberately requires BOTH:
 * 1. calldata matching a known Uniswap-V2-style router swap function, and
 * 2. sender-centric evidence showing one asset leave and a different asset enter.
 *
 * Asset movement alone is not enough to call something a swap. The current
 * asset-flow coverage does not include internal native transfers, so some valid
 * token->native swaps will intentionally remain unclassified until tracing is added.
 */
export function detectSwapClassification({ tx, receipt, assetFlows }) {
  if (receipt?.status !== "0x1") return null;

  const selector = selectorOf(tx?.input);
  const method = selector ? V2_SWAP_SELECTORS.get(selector) : null;
  if (!method) return null;

  const assetsOut = Array.isArray(assetFlows?.assetsOut) ? assetFlows.assetsOut : [];
  const assetsIn = Array.isArray(assetFlows?.assetsIn) ? assetFlows.assetsIn : [];

  if (!hasDistinctAssets(assetsOut, assetsIn)) return null;

  return {
    type: "SWAP",
    confidence: "MEDIUM",
    reason: "The call matches a known swap function and the sender-side evidence shows one asset leaving while a different asset enters.",
    swap: {
      selector,
      method,
      assetsOut,
      assetsIn,
      coverage: assetFlows?.coverage || null,
    },
  };
}
