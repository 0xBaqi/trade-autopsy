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

function shortAddress(address) {
  if (typeof address !== "string" || address.length < 12) return "another address";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

    case "TOKEN_APPROVAL": {
      const approval = classification.approval || {};
      const spender = shortAddress(approval.spender);

      if (approval.approvalKind === "REVOKED") {
        return {
          verdict: "clean",
          summary: `You removed ${spender}'s permission to spend this token from your wallet.`,
          why: `This was a token approval set to zero, which removes the spending allowance. No token was sent by the approval itself. You paid ${fee} in network fees.`,
          tip: "No action is needed if you meant to revoke this permission.",
        };
      }

      if (approval.approvalKind === "UNLIMITED") {
        return {
          verdict: "warning",
          summary: `You gave ${spender} unlimited permission to spend this token from your wallet.`,
          why: `This transaction changed a token spending permission; it did not send the token by itself. Because the allowance is unlimited, ${spender} can spend this token later until you revoke or replace the permission. You paid ${fee} in network fees.`,
          tip: "Only keep unlimited approval if you trust the app or contract. Revoke it when you no longer need it.",
        };
      }

      return {
        verdict: "warning",
        summary: `You gave ${spender} permission to spend some of this token from your wallet.`,
        why: `This transaction changed a token spending permission; it did not send the token by itself. The approval has a specific limit rather than unlimited access. You paid ${fee} in network fees.`,
        tip: "Make sure you recognize the app or contract you approved and that you intended to give it spending permission.",
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
