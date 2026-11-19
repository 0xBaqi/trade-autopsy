// Pure presentation helpers for case files. No React. Moved verbatim from the old app/page.jsx so they can be unit-tested.
export const ACTION_LABELS = {
  SWAP: "SWAP", BRIDGE: "BRIDGE", TOKEN_APPROVAL: "APPROVAL", APPROVAL: "APPROVAL",
  PERMIT2_PERMISSION: "PERMIT2 PERMISSION", ERC20_TRANSFER: "TOKEN TRANSFER", NFT_TRANSFER: "NFT TRANSFER",
  NFT_PURCHASE: "NFT PURCHASE", NFT_SALE: "NFT SALE", NFT_MINT: "NFT MINT", NFT_BURN: "NFT BURN", NATIVE_TRANSFER: "NATIVE TRANSFER",
  CONTRACT_CREATION: "CONTRACT CREATION", CONTRACT_INTERACTION: "CONTRACT INTERACTION",
  FAILED: "FAILED ATTEMPT", UNKNOWN: "UNKNOWN ACTION",
};

export function short(addr) { if (!addr || addr.length < 10) return addr; return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
export function formatReadableAmount(value) {
  const text = String(value ?? "").trim(); if (!text) return text; if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const negative = text.startsWith("-"); const unsigned = negative ? text.slice(1) : text; const [whole, fraction = ""] = unsigned.split(".");
  if (!fraction) return `${negative ? "-" : ""}${whole}`; const numeric = Number(unsigned); if (!Number.isFinite(numeric)) return text;
  let maxDecimals = 4; if (numeric > 0 && numeric < 0.0001) maxDecimals = 8; else if (numeric < 1) maxDecimals = 6;
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, ""); return `${negative ? "-" : ""}${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}
export function displayAmount(asset) { if (!asset) return null; const amount = asset.amount ?? asset.rawAmount; if (amount == null) return null; return `${formatReadableAmount(amount)} ${asset.symbol || "token"}`; }
export function isPositiveNftMovement(transfer) { if (transfer?.standard !== "ERC1155") return transfer?.standard === "ERC721"; try { return BigInt(transfer?.quantity ?? "0") > 0n; } catch { return false; } }
export function nftLabel(transfer) { if (!transfer) return "NFT/item"; if (transfer.standard === "ERC721") return `ERC-721 NFT #${transfer.tokenId}`; const quantity = transfer.quantity && transfer.quantity !== "1" ? ` × ${transfer.quantity}` : ""; return `ERC-1155 item #${transfer.tokenId}${quantity}`; }
export function nftMovementText(transfer, wallet) {
  const fromWallet = transfer?.from?.toLowerCase() === wallet; const toWallet = transfer?.to?.toLowerCase() === wallet; const label = nftLabel(transfer);
  if (fromWallet && !toWallet) return `${label} left the sender wallet for ${short(transfer.to)}.`;
  if (toWallet && !fromWallet) return `${label} entered the sender wallet from ${short(transfer.from)}.`;
  return `${label} moved from ${short(transfer.from)} to ${short(transfer.to)}.`;
}

export function buildEvidenceTrail(caseData) {
  const items = []; const classification = caseData?.classification || {}; const type = classification.type;
  const out = caseData?.assetFlows?.assetsOut?.[0]; const incoming = caseData?.assetFlows?.assetsIn?.[0];
  const nftTransfers = Array.isArray(caseData?.nftTransfers) ? caseData.nftTransfers : []; const wallet = caseData?.from?.toLowerCase();
  const walletNftTransfers = wallet ? nftTransfers.filter((transfer) => isPositiveNftMovement(transfer) && (transfer?.from?.toLowerCase() === wallet || transfer?.to?.toLowerCase() === wallet)) : [];
  items.push({ tone: "proved", text: `Transaction confirmed on ${caseData.chain.name} at block ${caseData.blockNumber}.` });
  items.push({ tone: caseData.success ? "proved" : "warning", text: caseData.success ? "The chain marked this transaction as successful." : "The chain marked this transaction as reverted." });
  if ((type === "NFT_PURCHASE" || type === "NFT_SALE") && classification.marketplace) {
    const marketplace = classification.marketplace;
    const action = type === "NFT_PURCHASE" ? "purchase" : "sale";
    items.push({ tone: "proved", text: `${marketplace.protocol === "SEAPORT" ? "Seaport" : marketplace.protocol || "Marketplace"} ${marketplace.version || ""} OrderFulfilled evidence was emitted by the verified marketplace contract.`.replace("  ", " ") });
    if (marketplace.nft) items.push({ tone: "proved", text: `${nftLabel(marketplace.nft)} ${type === "NFT_PURCHASE" ? "entered" : "left"} the sender wallet.` });
    if (marketplace.payment) items.push({ tone: "proved", text: `${displayAmount(marketplace.payment)} ${type === "NFT_PURCHASE" ? "left the sender as consideration" : "entered the sender as sale consideration"}.` });
    items.push({ tone: "detail", text: `These independent marketplace, NFT, and payment facts support the ${action} classification.` });
    if (type === "NFT_SALE" && marketplace.paymentPerspective === "RECEIVED_BY_SENDER_GROSS") items.push({ tone: "warning", text: "The displayed incoming payment is gross receipt; fees or other outgoing transfers in the same transaction may reduce net proceeds." });
  } else if (type === "BRIDGE" && classification.bridge) {
    const bridge = classification.bridge; const chainNames = { "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis", "137": "Polygon", "324": "zkSync Era", "8453": "Base", "42161": "Arbitrum", "59144": "Linea" }; const protocol = bridge.protocol === "ACROSS" ? "Across" : bridge.protocol;
    items.push({ tone: "proved", text: `${protocol || "Bridge"} deposit evidence was observed from a verified bridge contract.` }); if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender during this transaction.` });
    if (bridge.destinationChainId) items.push({ tone: "detail", text: `Destination: ${chainNames[String(bridge.destinationChainId)] || `chain ${bridge.destinationChainId}`}.` }); if (bridge.depositId) items.push({ tone: "detail", text: `Deposit ID: ${bridge.depositId}.` }); items.push({ tone: "warning", text: "Destination delivery is not proven by this origin transaction alone." });
  } else if (type === "SWAP") {
    items.push({ tone: "proved", text: "The transaction matched verified swap evidence." }); if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` }); if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet in the same transaction.` });
  } else if (type === "TOKEN_APPROVAL") {
    items.push({ tone: "proved", text: "The calldata matched the standard ERC-20 approval function." }); if (classification.approval?.spender) items.push({ tone: "detail", text: `Spender: ${short(classification.approval.spender)}.` });
  } else if (type === "ERC20_TRANSFER" || type === "NATIVE_TRANSFER") {
    if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` }); if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet.` });
  } else if (type === "NFT_MINT") {
    for (const transfer of classification?.nft?.transfers || []) items.push({ tone: "proved", text: `${nftLabel(transfer)} was minted from the zero address into the sender wallet.` });
    if (out) items.push({ tone: "detail", text: `${displayAmount(out)} also left the sender during this transaction; Trade Autopsy does not assume that was the mint price.` }); items.push({ tone: "proved", text: "A zero-address origin is deterministic ERC-721/ERC-1155 mint evidence." });
  } else if (type === "NFT_BURN") {
    const relationship = classification?.nft?.relationship;
    for (const transfer of classification?.nft?.transfers || []) {
      const owner = relationship?.senderIsAssetOwner === false ? short(transfer.from) : "the sender wallet";
      items.push({ tone: "proved", text: `${nftLabel(transfer)} moved from ${owner} to the zero address.` });
    }
    if (relationship?.senderIsAssetOwner === false) items.push({ tone: "detail", text: "The transaction sender acted as the ERC-1155 operator; the affected asset belonged to another address." });
    items.push({ tone: "proved", text: "A zero-address destination is deterministic ERC-721/ERC-1155 burn evidence." });
  } else if (type === "NFT_TRANSFER") {
    if (walletNftTransfers.length > 4) {
      const outgoing = walletNftTransfers.filter((transfer) => transfer?.from?.toLowerCase() === wallet).length; const incomingCount = walletNftTransfers.length - outgoing;
      items.push({ tone: "proved", text: `${walletNftTransfers.length} positive-quantity ERC-1155 item movements involved the sender wallet: ${outgoing} outgoing and ${incomingCount} incoming.` });
      items.push({ tone: "detail", text: "Individual token IDs and quantities remain available in Technical evidence." });
    } else for (const transfer of walletNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) });
    items.push({ tone: "warning", text: "NFT transfer evidence proves movement, not whether it was a purchase, sale, or gift." });
  } else if (type === "CONTRACT_INTERACTION") {
    items.push({ tone: "warning", text: "A contract was called, but the available evidence does not prove one specific higher-level action." }); for (const transfer of walletNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) }); if (walletNftTransfers.length > 0) items.push({ tone: "warning", text: "These NFT/item movements are verified, but their economic meaning is not proven by transfer evidence alone." });
  }
  return items;
}


const HEADLINES = {
  SWAP: "Swapped one asset for another", BRIDGE: "Sent funds across a bridge", TOKEN_APPROVAL: "Approved a spender", APPROVAL: "Approved a spender",
  PERMIT2_PERMISSION: "Granted a Permit2 permission", ERC20_TRANSFER: "Sent tokens", NFT_TRANSFER: "Moved NFTs or items", NFT_PURCHASE: "Bought an NFT",
  NFT_SALE: "Sold an NFT", NFT_MINT: "Minted an NFT", NFT_BURN: "Burned an NFT", NATIVE_TRANSFER: "Sent the chain's native coin",
  CONTRACT_CREATION: "Created a contract", CONTRACT_INTERACTION: "Called a contract", FAILED_TRANSACTION: "Transaction failed", FAILED: "Transaction failed",
};

// Page title comes from the deterministic classification, never from model output.
export function headlineFor(type, success = true) {
  if (success === false) return "Transaction failed";
  return HEADLINES[type] || "Transaction we could not classify";
}
