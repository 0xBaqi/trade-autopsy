function formatDisplayAmount(amount) {
  if (amount == null) return null;
  const text = String(amount);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return text;
  const [whole, fraction = ""] = text.split(".");
  if (!fraction) return whole;
  const wholeValue = BigInt(whole || "0");
  let maxDecimals;
  if (wholeValue >= 1000n) maxDecimals = 2;
  else if (wholeValue >= 1n) maxDecimals = 4;
  else maxDecimals = 6;
  const kept = fraction.slice(0, maxDecimals);
  const nextDigit = fraction[maxDecimals];
  let roundedFraction = kept;
  let roundedWhole = wholeValue;
  if (nextDigit && Number(nextDigit) >= 5 && kept.length > 0) {
    const scale = 10n ** BigInt(kept.length);
    let fractionValue = BigInt(kept) + 1n;
    if (fractionValue >= scale) { roundedWhole += 1n; fractionValue = 0n; }
    roundedFraction = fractionValue.toString().padStart(kept.length, "0");
  }
  roundedFraction = roundedFraction.replace(/0+$/, "");
  const originalIsNonZero = wholeValue !== 0n || /[1-9]/.test(fraction);
  if (roundedWhole === 0n && !roundedFraction && originalIsNonZero) return `<${`0.${"0".repeat(maxDecimals - 1)}1`}`;
  return roundedFraction ? `${roundedWhole}.${roundedFraction}` : roundedWhole.toString();
}

function formatAsset(asset) {
  const amount = formatDisplayAmount(asset?.amount);
  const label = asset?.symbol;
  if (amount != null && label) return `${amount} ${label}`;
  if (label) return label;
  return "a token";
}
function firstAsset(flowList) { return Array.isArray(flowList) && flowList.length > 0 ? flowList[0] : null; }
function shortAddress(address) { return typeof address === "string" && address.length >= 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : "another address"; }
function activityCounts(activities) { const counts = {}; for (const activity of activities || []) if (activity?.type) counts[activity.type] = (counts[activity.type] || 0) + 1; return counts; }
function chainNameFromEvmId(chainId) {
  const names = { "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis", "137": "Polygon", "324": "zkSync Era", "8453": "Base", "42161": "Arbitrum", "59144": "Linea" };
  return names[String(chainId)] || `chain ${chainId}`;
}
function nftMovementForSender(data) {
  const sender = data?.from?.toLowerCase();
  const transfers = Array.isArray(data?.nftTransfers) ? data.nftTransfers : [];
  const outgoing = transfers.filter((transfer) => transfer?.from?.toLowerCase() === sender);
  const incoming = transfers.filter((transfer) => transfer?.to?.toLowerCase() === sender);
  return { outgoing, incoming };
}
function nftLabel(transfer) {
  if (!transfer) return "an NFT";
  const standard = transfer.standard === "ERC1155" ? "ERC-1155 token" : "NFT";
  const quantity = transfer.standard === "ERC1155" && transfer.quantity !== "1" ? `${transfer.quantity} units of ` : "";
  return `${quantity}${standard} #${transfer.tokenId}`;
}

export function buildDeterministicAnalysis(data) {
  const classification = data?.classification || { type: "UNKNOWN", confidence: "LOW", reason: "No classification was available." };
  const flows = data?.assetFlows || {};
  const inAsset = firstAsset(flows.assetsIn);
  const outAsset = firstAsset(flows.assetsOut);
  const fee = `${data?.feeEth ?? "0"} ${data?.chain?.symbol || "native token"}`;
  if (!data?.success || classification.type === "FAILED_TRANSACTION") return { verdict: "failed", summary: "This transaction failed, so the action you tried to make did not go through.", why: `The blockchain marked the transaction as failed. You may still have paid ${fee} in network fees for the attempt.`, tip: "Before trying again, check the transaction details to see why it failed." };

  switch (classification.type) {
    case "NATIVE_TRANSFER": return { verdict: "clean", summary: `You sent ${data.value} ${data.chain.symbol} to another address.`, why: `The blockchain shows a direct ${data.chain.symbol} transfer with no extra contract action. You paid ${fee} in network fees.`, tip: "For future transfers, double-check the receiving address and network fee before sending." };
    case "ERC20_TRANSFER": { const movement = outAsset ? formatAsset(outAsset) : "a token"; return { verdict: "clean", summary: `You sent ${movement} to another address.`, why: `The blockchain recorded a token transfer from your wallet. You paid ${fee} in network fees.`, tip: "Before sending tokens again, double-check the token and receiving address." }; }
    case "NFT_TRANSFER": {
      const { outgoing, incoming } = nftMovementForSender(data);
      if (outgoing.length === 1 && incoming.length === 0) return { verdict: "clean", summary: `You sent ${nftLabel(outgoing[0])} to another address.`, why: `The receipt contains a standard ${outgoing[0].standard} transfer event showing this NFT movement from your wallet. This proves the transfer, but does not by itself prove a sale or purchase. You paid ${fee} in network fees.`, tip: "Confirm the recipient and token ID match what you intended to transfer." };
      if (incoming.length === 1 && outgoing.length === 0) return { verdict: "clean", summary: `You received ${nftLabel(incoming[0])}.`, why: `The receipt contains a standard ${incoming[0].standard} transfer event showing this NFT movement into your wallet. This proves the transfer, but does not by itself prove a purchase or mint. You paid ${fee} in network fees.`, tip: "Check the NFT contract and token ID before assuming where it came from or what it is worth." };
      return { verdict: "clean", summary: `This transaction moved ${data.nftTransferCount || data.nftTransfers?.length || 0} NFT item${(data.nftTransferCount || data.nftTransfers?.length) === 1 ? "" : "s"}.`, why: `Standard ERC-721/ERC-1155 transfer events prove the NFT movements. Trade Autopsy is not labeling them as a sale, purchase, or mint without separate payment or mint evidence. You paid ${fee} in network fees.`, tip: "Review the NFT token IDs, quantities, and addresses in the evidence before assigning a higher-level meaning to the transaction." };
    }
    case "TOKEN_APPROVAL": {
      const approval = classification.approval || {}; const spender = shortAddress(approval.spender);
      if (approval.approvalKind === "REVOKED") return { verdict: "clean", summary: `You removed ${spender}'s permission to spend this token from your wallet.`, why: `This was a token approval set to zero, which removes the spending allowance. No token was sent by the approval itself. You paid ${fee} in network fees.`, tip: "No action is needed if you meant to revoke this permission." };
      if (approval.approvalKind === "UNLIMITED") return { verdict: "warning", summary: `You gave ${spender} unlimited permission to spend this token from your wallet.`, why: `This transaction changed a token spending permission; it did not send the token by itself. Because the allowance is unlimited, ${spender} can spend this token later until you revoke or replace the permission. You paid ${fee} in network fees.`, tip: "Only keep unlimited approval if you trust the app or contract. Revoke it when you no longer need it." };
      return { verdict: "warning", summary: `You gave ${spender} permission to spend some of this token from your wallet.`, why: `This transaction changed a token spending permission; it did not send the token by itself. The approval has a specific limit rather than unlimited access. You paid ${fee} in network fees.`, tip: "Make sure you recognize the app or contract you approved and that you intended to give it spending permission." };
    }
    case "SWAP": {
      const swapOut = firstAsset(classification?.swap?.assetsOut) || outAsset;
      const swapIn = firstAsset(classification?.swap?.assetsIn) || inAsset;
      const gave = formatAsset(swapOut); const received = formatAsset(swapIn);
      const routerWhy = classification?.swap?.routerType === "PANCAKE_UNIVERSAL_ROUTER"
        ? `The transaction called a verified PancakeSwap Universal Router, while the on-chain asset evidence shows ${gave} leaving your wallet and ${received} entering it.`
        : `The transaction used a known swap function, ${gave} left your wallet, and ${received} came back during the same successful transaction.`;
      return { verdict: "clean", summary: `You swapped ${gave} for ${received}.`, why: `${routerWhy} You paid ${fee} in network fees.`, tip: "Check that the amount you received matches what you expected from the swap." };
    }
    case "BRIDGE": {
      const bridge = classification.bridge || {};
      const sent = outAsset ? formatAsset(outAsset) : "a token";
      const destination = chainNameFromEvmId(bridge.destinationChainId);
      const protocol = bridge.protocol === "ACROSS" ? "Across" : "a bridge";
      return {
        verdict: "clean",
        summary: `You initiated a bridge of ${sent} from ${data.chain.name} toward ${destination} using ${protocol}.`,
        why: `The source-chain transaction succeeded, a verified bridge-deposit event identified ${destination} as the destination, and the on-chain token movement confirms ${sent} left your wallet. This proves the bridge was initiated, but this transaction alone does not prove the funds arrived on ${destination}. You paid ${fee} in network fees.`,
        tip: `Check the destination-chain fill before treating the bridge as complete.`,
      };
    }
    case "CONTRACT_CREATION": return { verdict: "clean", summary: "This transaction created a new smart contract on the blockchain.", why: `The transaction created a contract instead of sending funds to an existing address. You paid ${fee} in network fees.`, tip: "If you expected to create a contract, confirm the new contract address before using it." };
    case "CONTRACT_INTERACTION": {
      const counts = activityCounts(data?.activities); const transferActivities = counts.TOKEN_TRANSFER_ACTIVITY || 0; const nftActivities = counts.NFT_TRANSFER_ACTIVITY || 0; const knownActivities = (counts.SWAP_ACTIVITY || 0) + (counts.APPROVAL_ACTIVITY || 0);
      let movementSummary = "We can confirm that your wallet interacted with an on-chain app, but the exact action is not clear enough to name safely.";
      if (inAsset && outAsset) movementSummary = `A token left your wallet and ${formatAsset(inAsset)} came into your wallet during this transaction.`;
      else if (outAsset) movementSummary = `${formatAsset(outAsset)} left your wallet during this transaction.`;
      else if (inAsset) movementSummary = `${formatAsset(inAsset)} came into your wallet during this transaction.`;
      else if (nftActivities > 0) movementSummary = `${nftActivities} NFT movement${nftActivities === 1 ? " was" : "s were"} observed during this contract interaction.`;
      if (transferActivities > 1 || nftActivities > 1 || knownActivities > 1) return { verdict: "warning", summary: movementSummary, why: `This was a composite smart-contract transaction with ${transferActivities} fungible-token movement${transferActivities === 1 ? "" : "s"} and ${nftActivities} NFT movement${nftActivities === 1 ? "" : "s"}. We can verify those movements, but the evidence does not safely prove that the whole transaction was one specific action such as a swap, bridge, or NFT purchase. You paid ${fee} in network fees.`, tip: "Review each asset movement and the contract call together before deciding what the transaction was intended to do." };
      return { verdict: "warning", summary: movementSummary, why: `Your wallet used a smart contract rather than making a simple transfer. The on-chain evidence is not strong enough for us to safely call this a swap, bridge, purchase, or another specific action. You paid ${fee} in network fees.`, tip: "Check the verified asset movements below and confirm they match what you expected." };
    }
    default: return { verdict: "warning", summary: "The transaction succeeded, but there is not enough clear evidence to explain exactly what it did.", why: `We can verify the transaction on-chain, but it does not match one of the transaction types Trade Autopsy can explain confidently yet. You paid ${fee} in network fees.`, tip: "Check the raw evidence and block explorer before assuming what happened." };
  }
}
