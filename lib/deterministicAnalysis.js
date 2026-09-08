function formatAsset(asset) {
  const amount = asset?.amount;
  const label = asset?.symbol;
  if (amount != null && label) return `${amount} ${label}`;
  if (label) return label;
  return "a token";
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
      summary: "This transaction failed, so the action you tried to make did not go through.",
      why: `The blockchain marked the transaction as failed. You may still have paid ${fee} in network fees for the attempt.`,
      tip: "Before trying again, check the transaction details to see why it failed.",
    };
  }

  switch (classification.type) {
    case "NATIVE_TRANSFER":
      return {
        verdict: "clean",
        summary: `You sent ${data.value} ${data.chain.symbol} to another address.`,
        why: `The blockchain shows a direct ${data.chain.symbol} transfer with no extra contract action. You paid ${fee} in network fees.`,
        tip: "For future transfers, double-check the receiving address and network fee before sending.",
      };

    case "ERC20_TRANSFER": {
      const movement = outAsset ? formatAsset(outAsset) : "a token";
      return {
        verdict: "clean",
        summary: `You sent ${movement} to another address.`,
        why: `The blockchain recorded a token transfer from your wallet. You paid ${fee} in network fees.`,
        tip: "Before sending tokens again, double-check the token and receiving address.",
      };
    }

    case "CONTRACT_CREATION":
      return {
        verdict: "clean",
        summary: "This transaction created a new smart contract on the blockchain.",
        why: `The transaction created a contract instead of sending funds to an existing address. You paid ${fee} in network fees.`,
        tip: "If you expected to create a contract, confirm the new contract address before using it.",
      };

    case "CONTRACT_INTERACTION": {
      let movementSummary = "We can confirm that your wallet interacted with an on-chain app, but the exact action is not clear enough to name safely.";
      if (inAsset && outAsset) movementSummary = `A token left your wallet and ${formatAsset(inAsset)} came into your wallet during this transaction.`;
      else if (outAsset) movementSummary = `${formatAsset(outAsset)} left your wallet during this transaction.`;
      else if (inAsset) movementSummary = `${formatAsset(inAsset)} came into your wallet during this transaction.`;

      return {
        verdict: "warning",
        summary: movementSummary,
        why: `Your wallet used a smart contract rather than making a simple transfer. The on-chain evidence is not strong enough for us to safely call this a swap, bridge, purchase, or another specific action. You paid ${fee} in network fees.`,
        tip: "If you expected a swap, bridge, or purchase, check the token movements below and confirm that what left and entered your wallet matches what you expected.",
      };
    }

    default:
      return {
        verdict: "warning",
        summary: "The transaction succeeded, but there is not enough clear evidence to explain exactly what it did.",
        why: `We can verify the transaction on-chain, but it does not match one of the transaction types Trade Autopsy can explain confidently yet. You paid ${fee} in network fees.`,
        tip: "Check the raw evidence and block explorer before assuming what happened.",
      };
  }
}
