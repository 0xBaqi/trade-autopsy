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

function evidenceOrderFor(activity) {
  const commandIndex = commandIndexFor(activity);
  if (Number.isInteger(commandIndex)) {
    return { source: "COMMAND_INDEX", index: commandIndex };
  }

  const logIndex = activity?.evidence?.logIndex;
  if (Number.isInteger(logIndex)) {
    return { source: "LOG_INDEX", index: logIndex };
  }

  const traceIndex = activity?.evidence?.traceIndex;
  if (Number.isInteger(traceIndex)) {
    return { source: "TRACE_INDEX", index: traceIndex };
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
    orderEvidence: evidenceOrderFor(activity),
    evidence: activity.evidence || null,
  };
}

function fallbackStep(classification) {
  if (!classification?.type || classification.type === "UNKNOWN") return null;

  return {
    type: classification.type,
    confidence: classification.confidence || "MEDIUM",
    sourceActivity: null,
    orderEvidence: null,
    evidence: null,
  };
}

function verifiedOrdering(steps) {
  if (steps.length < 2) return null;
  const evidence = steps.map((step) => step.orderEvidence);
  if (evidence.some((item) => !item)) return null;

  const sources = new Set(evidence.map((item) => item.source));
  if (sources.size !== 1) return null;

  return evidence[0].source;
}

export function reconstructActionSequence({ classification, activities }) {
  if (classification?.type === "FAILED") {
    return {
      version: 2,
      ordering: "TOP_LEVEL_ONLY",
      orderingSource: null,
      steps: [fallbackStep(classification)].filter(Boolean),
      supportingActivityCount: (activities || []).length,
    };
  }

  const primary = (activities || []).map(stepFromActivity).filter(Boolean);
  const orderingSource = verifiedOrdering(primary);

  if (orderingSource) {
    primary.sort((a, b) => a.orderEvidence.index - b.orderEvidence.index);
  }

  const steps = primary.length > 0 ? primary : [fallbackStep(classification)].filter(Boolean);

  return {
    version: 2,
    ordering: orderingSource ? "VERIFIED_EVIDENCE_ORDER" : steps.length > 1 ? "MULTIPLE_PRIMARY_ACTIONS_ORDER_UNPROVEN" : "SINGLE_PRIMARY_ACTION",
    orderingSource,
    steps,
    supportingActivityCount: (activities || []).filter((activity) => !PRIMARY_ACTIONS[activity?.type]).length,
  };
}
