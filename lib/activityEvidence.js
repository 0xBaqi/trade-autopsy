function transferActivity(transfer) {
  return {
    type: "TOKEN_TRANSFER_ACTIVITY",
    confidence: "HIGH",
    evidence: {
      tokenAddress: transfer.tokenAddress,
      from: transfer.from,
      to: transfer.to,
      rawAmount: transfer.rawAmount,
      symbol: transfer.symbol ?? null,
      decimals: Number.isInteger(transfer.decimals) ? transfer.decimals : null,
      amount: transfer.amount ?? null,
    },
  };
}

function swapActivity(classification) {
  if (classification?.type !== "SWAP" || !classification.swap) return null;

  return {
    type: "SWAP_ACTIVITY",
    confidence: classification.confidence || "MEDIUM",
    evidence: {
      selector: classification.swap.selector,
      method: classification.swap.method,
      assetsOut: classification.swap.assetsOut || [],
      assetsIn: classification.swap.assetsIn || [],
      coverage: classification.swap.coverage || null,
    },
  };
}

function approvalActivity(classification) {
  if (classification?.type !== "TOKEN_APPROVAL" || !classification.approval) return null;

  return {
    type: "APPROVAL_ACTIVITY",
    confidence: classification.confidence || "HIGH",
    evidence: { ...classification.approval },
  };
}

/**
 * Build an additive evidence layer describing grounded activities observed in
 * the transaction. Activities are evidence records, not a claim about the
 * transaction's overall intent. This lets later milestones compose complex
 * transactions without weakening the conservative top-level classifier.
 */
export function buildActivityEvidence({ classification, tokenTransfers }) {
  const activities = [];

  const swap = swapActivity(classification);
  if (swap) activities.push(swap);

  const approval = approvalActivity(classification);
  if (approval) activities.push(approval);

  for (const transfer of tokenTransfers || []) {
    activities.push(transferActivity(transfer));
  }

  return activities;
}
