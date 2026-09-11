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
function formatAsset(asset) { const amount = formatDisplayAmount(asset?.amount); const label = asset?.symbol; if (amount != null && label) return `${amount} ${label}`; if (label) return label; return "a token"; }
function firstAsset(flowList) { return Array.isArray(flowList) && flowList.length > 0 ? flowList[0] : null; }
function shortAddress(address) { return typeof address === "string" && address.length >= 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : "another address"; }
function chainNameFromEvmId(chainId) { const names = { "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis", "137": "Polygon", "324": "zkSync Era", "8453": "Base", "42161": "Arbitrum", "59144": "Linea" }; return names[String(chainId)] || `chain ${chainId}`; }
function isPositiveNftMovement(transfer) {
  if (transfer?.standard !== "ERC1155") return transfer?.standard === "ERC721";
  try { return BigInt(transfer?.quantity ?? "0") > 0n; } catch { return false; }
}
function nftMovementForSender(data) {
  const sender = data?.from?.toLowerCase();
  const transfers = (Array.isArray(data?.nftTransfers) ? data.nftTransfers : []).filter(isPositiveNftMovement);
  return { outgoing: transfers.filter((t) => t?.from?.toLowerCase() === sender), incoming: transfers.filter((t) => t?.to?.toLowerCase() === sender) };
}
function nftLabel(transfer) { if (!transfer) return "an NFT"; const standard = transfer.standard === "ERC1155" ? "ERC-1155 item" : "ERC-721 NFT"; const quantity = transfer.standard === "ERC1155" && transfer.quantity !== "1" ? `${transfer.quantity} units of ` : ""; return `${quantity}${standard} #${transfer.tokenId}`; }
function walletNftLabel(item) { if (!item) return "an NFT/item"; const standard = item.assetType === "ERC1155" ? "ERC-1155 item" : "ERC-721 NFT"; const quantity = item.assetType === "ERC1155" && item.quantity !== "1" ? `${item.quantity} units of ` : ""; return `${quantity}${standard} #${item.tokenId}`; }
function joinParts(parts) { if (parts.length <= 1) return parts[0] || ""; if (parts.length === 2) return `${parts[0]} and ${parts[1]}`; return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`; }
function walletSummary(data) {
  const w = data?.walletActivity;
  if (!w) return null;
  const parts = [];
  for (const asset of w.nativeOut || []) parts.push(`${formatAsset(asset)} left your wallet`);
  for (const asset of w.fungibleOut || []) parts.push(`${formatAsset(asset)} left your wallet`);
  for (const item of w.nftOut || []) parts.push(`${walletNftLabel(item)} left your wallet`);
  for (const asset of w.nativeIn || []) parts.push(`${formatAsset(asset)} entered your wallet`);
  for (const asset of w.fungibleIn || []) parts.push(`${formatAsset(asset)} entered your wallet`);
  for (const item of w.nftIn || []) parts.push(`${walletNftLabel(item)} entered your wallet`);
  if (!parts.length) return null;
  return `${joinParts(parts)}.`;
}

export function buildDeterministicAnalysis(data) {
  const classification = data?.classification || { type: "UNKNOWN", confidence: "LOW", reason: "No classification was available." };
  const flows = data?.assetFlows || {};
  const inAsset = firstAsset(flows.assetsIn); const outAsset = firstAsset(flows.assetsOut);
  const fee = `${data?.feeEth ?? "0"} ${data?.chain?.symbol || "native token"}`;
  if (!data?.success || classification.type === "FAILED_TRANSACTION") return { verdict: "failed", summary: "This transaction failed, so the action you tried to make did not go through.", why: `The blockchain marked the transaction as failed. You may still have paid ${fee} in network fees for the attempt.`, tip: "Before trying again, check the transaction details to see why it failed." };
  switch (classification.type) {
    case "NATIVE_TRANSFER": return { verdict: "clean", summary: `You sent ${data.value} ${data.chain.symbol} to another address.`, why: `The blockchain shows a direct ${data.chain.symbol} transfer with no extra contract action. You paid ${fee} in network fees.`, tip: "For future transfers, double-check the receiving address and network fee before sending." };
    case "ERC20_TRANSFER": { const movement = outAsset ? formatAsset(outAsset) : "a token"; return { verdict: "clean", summary: `You sent ${movement} to another address.`, why: `The blockchain recorded a token transfer from your wallet. You paid ${fee} in network fees.`, tip: "Before sending tokens again, double-check the token and receiving address." }; }
    case "NFT_TRANSFER": {
      const { outgoing, incoming } = nftMovementForSender(data);
      if (outgoing.length === 1 && incoming.length === 0) return { verdict: "clean", summary: `You sent ${nftLabel(outgoing[0])} to another address.`, why: `A standard ${outgoing[0].standard} transfer event proves this item left your wallet. It does not by itself prove a sale or purchase. You paid ${fee} in network fees.`, tip: "Confirm the recipient and token ID match what you intended to transfer." };
      if (incoming.length === 1 && outgoing.length === 0) return { verdict: "clean", summary: `You received ${nftLabel(incoming[0])}.`, why: `A standard ${incoming[0].standard} transfer event proves this item entered your wallet. It does not by itself prove a purchase or mint. You paid ${fee} in network fees.`, tip: "Check the collection contract and token ID before assuming where it came from or what it is worth." };
      const movementCount = outgoing.length + incoming.length;
      if (movementCount > 4) return { verdict: "clean", summary: `${movementCount} ERC-1155 item movements involved your wallet: ${outgoing.length} outgoing and ${incoming.length} incoming.`, why: `Standard ERC-1155 transfer events prove these positive-quantity wallet movements. Zero-quantity batch entries are retained only as raw evidence and are not counted as movements. The events do not by themselves prove a purchase, sale, mint, burn, or gift. You paid ${fee} in network fees.`, tip: "Open Technical evidence if you need the individual token IDs and quantities." };
      return { verdict: "clean", summary: walletSummary(data) || `This transaction moved ${movementCount} NFT/items involving your wallet.`, why: `Standard ERC-721/ERC-1155 transfer events prove the wallet movements, but not their economic meaning. You paid ${fee} in network fees.`, tip: "Review the token IDs, quantities, and addresses before assigning a higher-level meaning." };
    }
    case "NFT_MINT": {
      const minted = classification?.nft?.transfers || [];
      const itemText = minted.length === 1 ? nftLabel(minted[0]) : `${minted.length} NFT/item entries`;
      const paid = (data?.walletActivity?.nativeOut || []).map(formatAsset).filter(Boolean);
      const paymentText = paid.length ? ` ${paid.join(" and ")} also left your wallet in this transaction, but that alone does not prove the mint price or recipient of the payment.` : "";
      return { verdict: "clean", summary: `You minted ${itemText} into your wallet.`, why: `The NFT standard gives us direct lifecycle evidence: ${itemText} moved from the zero address into your wallet, which proves creation/minting.${paymentText} You paid ${fee} in network fees.`, tip: "Use the token contract and token ID to verify the collection; treat any payment amount separately unless the mint contract or event proves the price." };
    }
    case "NFT_BURN": {
      const burned = classification?.nft?.transfers || [];
      const itemText = burned.length === 1 ? nftLabel(burned[0]) : `${burned.length} NFT/item entries`;
      const relationship = classification?.nft?.relationship || null;
      if (relationship?.senderIsAssetOwner === false) {
        const owner = relationship.affectedOwners?.length === 1 ? shortAddress(relationship.affectedOwners[0]) : "another address";
        return { verdict: "clean", summary: `This transaction initiated a burn of ${itemText} from ${owner}.`, why: `Standard ERC-1155 evidence proves ${itemText} moved from ${owner} to the zero address. The transaction sender was the ERC-1155 operator, not the asset owner, so Trade Autopsy does not describe the item as leaving your wallet. You paid ${fee} in network fees.`, tip: "Confirm the affected owner and token ID match the burn you intended to initiate." };
      }
      return { verdict: "clean", summary: `You burned ${itemText} from your wallet.`, why: `The NFT standard gives us direct lifecycle evidence: ${itemText} moved from your wallet to the zero address, which proves burning. You paid ${fee} in network fees.`, tip: "Confirm the token ID was the item you intended to destroy; a burn is normally irreversible." };
    }
    case "TOKEN_APPROVAL": { const approval = classification.approval || {}; const spender = shortAddress(approval.spender); if (approval.approvalKind === "REVOKED") return { verdict: "clean", summary: `You removed ${spender}'s permission to spend this token from your wallet.`, why: `This was a token approval set to zero. No token was sent by the approval itself. You paid ${fee} in network fees.`, tip: "No action is needed if you meant to revoke this permission." }; if (approval.approvalKind === "UNLIMITED") return { verdict: "warning", summary: `You gave ${spender} unlimited permission to spend this token from your wallet.`, why: `This changed a token spending permission; it did not send the token by itself. You paid ${fee} in network fees.`, tip: "Only keep unlimited approval if you trust the app or contract." }; return { verdict: "warning", summary: `You gave ${spender} permission to spend some of this token from your wallet.`, why: `This changed a token spending permission; it did not send the token by itself. You paid ${fee} in network fees.`, tip: "Make sure you recognize the app or contract you approved." }; }
    case "SWAP": { const swapOut = firstAsset(classification?.swap?.assetsOut) || outAsset; const swapIn = firstAsset(classification?.swap?.assetsIn) || inAsset; const gave = formatAsset(swapOut); const received = formatAsset(swapIn); return { verdict: "clean", summary: `You swapped ${gave} for ${received}.`, why: `The verified call and asset evidence support this swap: ${gave} left your wallet and ${received} entered it. You paid ${fee} in network fees.`, tip: "Check that the amount you received matches what you expected." }; }
    case "BRIDGE": { const bridge = classification.bridge || {}; const sent = outAsset ? formatAsset(outAsset) : "a token"; const destination = chainNameFromEvmId(bridge.destinationChainId); const protocol = bridge.protocol === "ACROSS" ? "Across" : "a bridge"; return { verdict: "clean", summary: `You initiated a bridge of ${sent} from ${data.chain.name} toward ${destination} using ${protocol}.`, why: `Verified source-chain evidence proves the bridge was initiated, but this transaction alone does not prove arrival on ${destination}. You paid ${fee} in network fees.`, tip: "Check the destination-chain fill before treating the bridge as complete." }; }
    case "CONTRACT_CREATION": return { verdict: "clean", summary: "This transaction created a new smart contract on the blockchain.", why: `The transaction created a contract instead of sending funds to an existing address. You paid ${fee} in network fees.`, tip: "Confirm the new contract address before using it." };
    case "CONTRACT_INTERACTION": {
      const w = data?.walletActivity || {};
      const walletNfts = w.walletNftMovementCount || 0;
      const backgroundNfts = w.backgroundNftMovementCount || 0;
      const summary = walletSummary(data) || "Your wallet interacted with a smart contract, but no supported wallet asset movement was reconstructed.";
      const background = backgroundNfts > 0 ? ` ${backgroundNfts} additional NFT/item event${backgroundNfts === 1 ? " occurred" : "s occurred"} elsewhere in the transaction; ${backgroundNfts === 1 ? "it is" : "they are"} background evidence, not a wallet movement.` : "";
      const nftMeaning = walletNfts > 0 ? " The NFT/item movement is proven, but transfer evidence alone does not prove a purchase, sale, mint, burn, or gift." : "";
      return { verdict: "warning", summary, why: `This was a smart-contract transaction. Trade Autopsy reconstructed what entered and left your wallet without guessing the contract's intent.${nftMeaning}${background} You paid ${fee} in network fees.`, tip: "Use the verified wallet movements first; only assign a higher-level action when independent evidence proves it." };
    }
    default: return { verdict: "warning", summary: "The transaction succeeded, but there is not enough clear evidence to explain exactly what it did.", why: `We can verify the transaction on-chain, but it does not match one of the transaction types Trade Autopsy can explain confidently yet. You paid ${fee} in network fees.`, tip: "Check the raw evidence and block explorer before assuming what happened." };
  }
}
