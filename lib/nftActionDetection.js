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

function positiveNftQuantity(transfer) {
  if (transfer?.standard !== "ERC1155") return true;
  try { return BigInt(transfer?.quantity ?? "0") > 0n; }
  catch { return false; }
}

function selectorFromInput(input) {
  return typeof input === "string" && /^0x[0-9a-fA-F]{8}/.test(input)
    ? input.slice(0, 10).toLowerCase()
    : null;
}

function uniqueAddresses(transfers = []) {
  const seen = new Set();
  const addresses = [];
  for (const transfer of transfers) {
    const address = transfer?.from;
    if (typeof address !== "string") continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }
  return addresses;
}

/**
 * Detect NFT lifecycle actions only where the token standard itself gives us
 * deterministic evidence. ERC-721/ERC-1155 define a positive-value transfer
 * from the zero address as creation/minting and to the zero address as burning.
 * Zero-value ERC-1155 batch entries remain raw evidence, not lifecycle actions.
 *
 * tx.from is the transaction initiator, not necessarily the asset owner. For
 * ERC-1155, the TransferSingle/TransferBatch operator field can prove that the
 * transaction sender initiated a burn on behalf of another address without
 * implying that the burned item belonged to the sender wallet.
 *
 * This deliberately does NOT infer marketplace purchase/sale or a mint price.
 * A native-value payment and an NFT mint in the same transaction are related
 * evidence, but price semantics require stronger contract/event proof.
 */
export function detectNftLifecycleAction({ tx, nftTransfers = [] }) {
  const wallet = tx?.from;
  if (!wallet) return null;
  const positiveTransfers = (Array.isArray(nftTransfers) ? nftTransfers : []).filter(positiveNftQuantity);

  const mintedToWallet = positiveTransfers.filter((transfer) =>
    isZeroAddress(transfer?.from) && sameAddress(transfer?.to, wallet)
  );
  const burnedFromWallet = positiveTransfers.filter((transfer) =>
    sameAddress(transfer?.from, wallet) && isZeroAddress(transfer?.to)
  );
  const operatorBurnsOtherWallet = positiveTransfers.filter((transfer) =>
    transfer?.standard === "ERC1155" &&
    !sameAddress(transfer?.from, wallet) &&
    isZeroAddress(transfer?.to) &&
    sameAddress(transfer?.operator, wallet)
  );
  const backgroundMints = positiveTransfers.filter((transfer) =>
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
      nft: {
        transfers: burnedFromWallet,
        relationship: {
          transactionInitiator: wallet,
          senderIsAssetOwner: true,
          senderRole: "ASSET_OWNER",
          affectedOwners: [wallet],
        },
      },
    };
  }

  if (operatorBurnsOtherWallet.length > 0 && mintedToWallet.length === 0 && burnedFromWallet.length === 0) {
    return {
      type: "NFT_BURN",
      confidence: "HIGH",
      reason: "ERC-1155 transfer evidence shows the transaction sender acting as operator while item(s) moved from another address to the zero address. This proves a burn initiated by the sender, but not a burn from the sender wallet.",
      nft: {
        transfers: operatorBurnsOtherWallet,
        relationship: {
          transactionInitiator: wallet,
          senderIsAssetOwner: false,
          senderRole: "ERC1155_OPERATOR",
          affectedOwners: uniqueAddresses(operatorBurnsOtherWallet),
        },
      },
    };
  }

  return null;
}
