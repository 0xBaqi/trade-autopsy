function formatAsset(asset) {
  const amount = asset?.amount ?? asset?.rawAmount;
  const label = asset?.symbol || asset?.tokenAddress || asset?.asset || "asset";
  return amount != null ? `${amount} ${label}` : label;
}

function firstAsset(flowList) {
  return Array.isArray(flowList) && flowList.length > 0 ? flowList[0] : null;
}

export function buildDeterministicAnalysis(data) {
  const classification = data?.classification || { type: "UNKNOWN", confidence: "LOW", reason: "No classification was available." };
  const flows = data?.assetFlows || {};
  const inAsset = firstAsset(flows.assetsIn);
  const outAsset = firstAsset(flows.assetsOut);
  const fee = `${data?.feeEth ?? "0"} ${data?.chain?.symbol || "native token"}`;

  if (!data?.success || classification.type === "FAILED_TRANSACTION") {
    return {
      verdict: "failed",
      summary: "This transaction failed or reverted, so the intended on-chain action did not complete.",
      why: `The receipt reports a failed status. A network fee of ${fee} may still have been paid for the attempted transaction.`,
      tip: "Check the failure reason and contract conditions before retrying the transaction.",
    };
  }

  switch (classification.type) {
    case "NATIVE_TRANSFER":
      return {
        verdict: "clean",
        summary: `This transaction sent ${data.value} ${data.chain.symbol} from the sender to the recipient.`,
        why: `The transaction had no calldata, sent native value, and emitted no decoded ERC-20 transfer events. The network fee was ${fee}.`,
        tip: "Verify the recipient address and fee before sending native tokens again.",
      };

    case "ERC20_TRANSFER": {
      const movement = outAsset ? formatAsset(outAsset) : data.transferCount ? `${data.transferCount} decoded ERC-20 transfer event${data.transferCount === 1 ? "" : "s"}` : "an ERC-20 token movement";
      return {
        verdict: "clean",
        summary: `This transaction performed an ERC-20 token transfer involving ${movement}.`,
        why: `${classification.reason} The network fee was ${fee}.`,
        tip: "Confirm the token contract and destination address before approving future transfers.",
      };
    }

    case "CONTRACT_CREATION":
      return {
        verdict: "clean",
        summary: "This transaction created a smart contract.",
        why: `${classification.reason} The network fee was ${fee}.`,
        tip: "Review the deployed contract address and bytecode before relying on the new contract.",
      };

    case "CONTRACT_INTERACTION": {
      let movementSummary = "The available deterministic evidence does not prove the exact contract action.";
      if (inAsset && outAsset) movementSummary = `Observed sender-side asset flows include ${formatAsset(outAsset)} out and ${formatAsset(inAsset)} in.`;
      else if (outAsset) movementSummary = `Observed sender-side asset flow includes ${formatAsset(outAsset)} out.`;
      else if (inAsset) movementSummary = `Observed sender-side asset flow includes ${formatAsset(inAsset)} in.`;

      return {
        verdict: "warning",
        summary: `This was a smart-contract interaction. ${movementSummary}`,
        why: `${classification.reason} Internal native transfers and unsupported protocol-specific actions are not inferred. The network fee was ${fee}.`,
        tip: "Open the raw evidence or explorer before assuming what the contract interaction did.",
      };
    }

    default:
      return {
        verdict: "warning",
        summary: "The transaction succeeded, but the available deterministic evidence does not support a more specific description.",
        why: `${classification.reason || "The transaction does not match a supported classification."} The network fee was ${fee}.`,
        tip: "Review the raw evidence and explorer details before drawing a stronger conclusion.",
      };
  }
}
