const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function isZeroAddress(address) {
  return sameAddress(address, ZERO_ADDRESS);
}

/**
 * Detect NFT lifecycle actions only where the token standard itself gives us
 * deterministic evidence. ERC-721/ERC-1155 define a transfer from the zero
 * address as creation/minting and a transfer to the zero address as burning.
 *
 * This deliberately does NOT infer marketplace purchase/sale. A payment and
 * an NFT movement in the same transaction are not enough on their own to
 * prove an economic trade.
 */
export function detectNftLifecycleAction({ tx, nftTransfers = [] }) {
  const wallet = tx?.from;
  if (!wallet) return null;

  const mintedToWallet = nftTransfers.filter((transfer) =>
    isZeroAddress(transfer?.from) && sameAddress(transfer?.to, wallet)
  );
  const burnedFromWallet = nftTransfers.filter((transfer) =>
    sameAddress(transfer?.from, wallet) && isZeroAddress(transfer?.to)
  );

  if (mintedToWallet.length > 0 && burnedFromWallet.length === 0) {
    return {
      type: "NFT_MINT",
      confidence: "HIGH",
      reason: "Standard ERC-721/ERC-1155 transfer evidence shows one or more items moving from the zero address into the sender wallet.",
      nft: { transfers: mintedToWallet },
    };
  }

  if (burnedFromWallet.length > 0 && mintedToWallet.length === 0) {
    return {
      type: "NFT_BURN",
      confidence: "HIGH",
      reason: "Standard ERC-721/ERC-1155 transfer evidence shows one or more items moving from the sender wallet to the zero address.",
      nft: { transfers: burnedFromWallet },
    };
  }

  return null;
}
