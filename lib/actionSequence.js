const PRIMARY_ACTIONS = {
  SWAP_ACTIVITY: "SWAP",
  BRIDGE_ACTIVITY: "BRIDGE",
  APPROVAL_ACTIVITY: "APPROVAL",
  PERMIT2_ACTIVITY: "PERMIT2_PERMISSION",
};

function commandIndexFor(activity) {
  if (activity?.type === "PERMIT2_ACTIVITY") {
    const indexes = (activity.evidence?.commands || [])
      .map((command) => command?.index)
      .filter(Number.isInteger);
    return indexes.length ? Math.min(...indexes) : null;
  }

  if (activity?.type === "SWAP_ACTIVITY") {
    const indexes = (activity.evidence?.universalRouterCommands?.commands || [])
      .filter((command) => command?.isSwap)
      .map((command) => command?.index)
      .filter(Number.isInteger);
    return indexes.length ? Math.min(...indexes) : null;
  }

  return null;
}

function stepFromActivity(activity) {
  const type = PRIMARY_ACTIONS[activity?.type];
  if (!type) return null;

  return {
    type,
    confidence: activity.confidence || "MEDIUM",
    sourceActivity: activity.type,
    commandIndex: commandIndexFor(activity),
    evidence: activity.evidence || null,
  };
}

function fallbackStep(classification) {
  if (!classification?.type || classification.type === "UNKNOWN") return null;

  return {
    type: classification.type,
    confidence: classification.confidence || "MEDIUM",
    sourceActivity: null,
    commandIndex: null,
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

  const primary = (activities || []).map(stepFromActivity).filter(Boolean);
  const commandOrdered = primary.filter((step) => Number.isInteger(step.commandIndex));
  const canVerifyCommandOrder = commandOrdered.length > 1;

  if (canVerifyCommandOrder) {
    primary.sort((a, b) => {
      const aIndex = Number.isInteger(a.commandIndex) ? a.commandIndex : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isInteger(b.commandIndex) ? b.commandIndex : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }

  const steps = primary.length > 0 ? primary : [fallbackStep(classification)].filter(Boolean);

  return {
    version: 1,
    ordering: canVerifyCommandOrder
      ? "VERIFIED_COMMAND_ORDER"
      : steps.length > 1
        ? "MULTIPLE_PRIMARY_ACTIONS_ORDER_UNPROVEN"
        : "SINGLE_PRIMARY_ACTION",
    steps,
    supportingActivityCount: (activities || []).filter((activity) => !PRIMARY_ACTIONS[activity?.type]).length,
  };
}
