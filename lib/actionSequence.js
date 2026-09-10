const PRIMARY_ACTIONS = {
  SWAP_ACTIVITY: "SWAP",
  BRIDGE_ACTIVITY: "BRIDGE",
  APPROVAL_ACTIVITY: "APPROVAL",
  PERMIT2_ACTIVITY: "PERMIT2_PERMISSION",
};

function stepFromActivity(activity) {
  const type = PRIMARY_ACTIONS[activity?.type];
  if (!type) return null;

  return {
    type,
    confidence: activity.confidence || "MEDIUM",
    sourceActivity: activity.type,
    evidence: activity.evidence || null,
  };
}

function fallbackStep(classification) {
  if (!classification?.type || classification.type === "UNKNOWN") return null;

  return {
    type: classification.type,
    confidence: classification.confidence || "MEDIUM",
    sourceActivity: null,
    evidence: null,
  };
}

export function reconstructActionSequence({ classification, activities }) {
  if (classification?.type === "FAILED") {
    return {
      version: 1,
      ordering: "TOP_LEVEL_ONLY",
      steps: [fallbackStep(classification)].filter(Boolean),
      supportingActivityCount: (activities || []).length,
    };
  }

  const primary = (activities || [])
    .map(stepFromActivity)
    .filter(Boolean);

  // A Universal Router Permit2 command is encoded before/alongside the swap
  // command stream. Preserve that proven command-level ordering. ERC-20
  // Transfer activities remain supporting evidence and are not promoted into
  // fake user actions.
  primary.sort((a, b) => {
    if (a.type === "PERMIT2_PERMISSION" && b.type === "SWAP") return -1;
    if (a.type === "SWAP" && b.type === "PERMIT2_PERMISSION") return 1;
    return 0;
  });

  const steps = primary.length > 0 ? primary : [fallbackStep(classification)].filter(Boolean);

  return {
    version: 1,
    ordering: primary.some((step) => step.type === "PERMIT2_PERMISSION") && primary.some((step) => step.type === "SWAP")
      ? "VERIFIED_COMMAND_ORDER"
      : "SINGLE_PRIMARY_ACTION",
    steps,
    supportingActivityCount: (activities || []).filter((activity) => !PRIMARY_ACTIONS[activity?.type]).length,
  };
}
