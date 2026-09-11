const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Explicitly known mint entrypoints. These strengthen an NFT_MINT explanation,
// but are not used to classify a transaction on their own.
const KNOWN_MINT_SELECTORS = new Map([
  ["0x00510ba5", "mintArtifact(uint256[],uint256[])"],
]);

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function isZeroAddress(address) {
  return sameAddress(address, ZERO_ADDRESS);
}

function selectorFromInput(input) {
  return typeof input === "string" && /^0x[0-9a-fA-F]{8}/.test(input)
    ? input.slice(0, 10).toLowerCase()
    : null;
}

/**
 * Detect NFT lifecycle actions only where the token standard itself gives us
 * deterministic evidence. ERC-721/ERC-1155 define a transfer from the zero
 * address as creation/minting and a transfer to the zero address as burning.
 *
 * This deliberately does NOT infer marketplace purchase/sale or a mint price.
 * A native-value payment and an NFT mint in the same transaction are related
 * evidence, but price semantics require stronger contract/event proof.
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
  const backgroundMints = nftTransfers.filter((transfer) =>
    isZeroAddress(transfer?.from) && !sameAddress(transfer?.to, wallet)
  );

  if (mintedToWallet.length > 0 && burnedFromWallet.length === 0) {
    const selector = selectorFromInput(tx?.input);
    const knownMintSignature = selector ? KNOWN_MINT_SELECTORS.get(selector) || null : null;
    const callValueWei = (() => {
      try { return BigInt(tx?.value || "0x0").toString(); } catch { return "0"; }
    })();

    return {
      type: "NFT_MINT",
      confidence: "HIGH",
      reason: "Standard ERC-721/ERC-1155 transfer evidence shows one or more items moving from the zero address into the sender wallet.",
      nft: {
        transfers: mintedToWallet,
        backgroundMints,
        callEvidence: {
          selector,
          knownMintSignature,
          nativeValueAttached: callValueWei !== "0",
          callValueWei,
          paymentMeaning: "ATTACHED_TO_MINT_CALL_NOT_PROVEN_AS_PRICE",
        },
      },
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
