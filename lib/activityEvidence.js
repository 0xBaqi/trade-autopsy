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

function swapActivity(detection) {
  if (detection?.type !== "SWAP" || !detection.swap) return null;
  return {
    type: "SWAP_ACTIVITY",
    confidence: detection.confidence || "MEDIUM",
    evidence: {
      selector: detection.swap.selector,
      method: detection.swap.method,
      routerType: detection.swap.routerType || null,
      assetsOut: detection.swap.assetsOut || [],
      assetsIn: detection.swap.assetsIn || [],
      coverage: detection.swap.coverage || null,
      universalRouterCommands: detection.swap.universalRouterCommands || null,
    },
  };
}

function bridgeActivity(detection) {
  if (detection?.type !== "BRIDGE" || !detection.bridge) return null;
  const bridge = detection.bridge;
  return {
    type: "BRIDGE_ACTIVITY",
    confidence: detection.confidence || "HIGH",
    evidence: {
      protocol: bridge.protocol,
      stage: bridge.stage,
      source: bridge.source,
      logIndex: Number.isInteger(bridge.logIndex) ? bridge.logIndex : null,
      spokePool: bridge.spokePool,
      destinationChainId: bridge.destinationChainId,
      depositId: bridge.depositId,
      depositor: bridge.depositor,
      recipient: bridge.recipient,
      inputToken: bridge.inputToken,
      outputToken: bridge.outputToken,
      inputRawAmount: bridge.inputRawAmount,
      outputRawAmount: bridge.outputRawAmount,
      destinationFillVerified: bridge.destinationFillVerified === true,
      coverage: bridge.coverage || null,
    },
  };
}

function permit2Activity(swapDetection) {
  const decoded = swapDetection?.swap?.universalRouterCommands;
  if (!decoded?.hasPermit2Command || !Array.isArray(decoded.commands)) return null;
  const commands = decoded.commands.filter((command) => command?.isPermit2);
  if (commands.length === 0) return null;
  return {
    type: "PERMIT2_ACTIVITY",
    confidence: "HIGH",
    evidence: {
      source: "UNIVERSAL_ROUTER_COMMAND_STREAM",
      commandCount: commands.length,
      commands: commands.map((command) => ({ index: command.index, commandId: command.commandId, name: command.name, allowRevert: command.allowRevert })),
    },
  };
}

function approvalActivity(classification) {
  if (classification?.type !== "TOKEN_APPROVAL" || !classification.approval) return null;
  return { type: "APPROVAL_ACTIVITY", confidence: classification.confidence || "HIGH", evidence: { ...classification.approval } };
}

export function buildActivityEvidence({ classification, detections, tokenTransfers }) {
  const activities = [];
  const bridge = bridgeActivity(detections?.bridge);
  if (bridge) activities.push(bridge);
  const swap = swapActivity(detections?.swap);
  if (swap) activities.push(swap);
  const permit2 = permit2Activity(detections?.swap);
  if (permit2) activities.push(permit2);
  const approval = approvalActivity(classification);
  if (approval) activities.push(approval);
  for (const transfer of tokenTransfers || []) activities.push(transferActivity(transfer));
  return activities;
}
