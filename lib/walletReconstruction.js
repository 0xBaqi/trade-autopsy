function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function positiveAmount(amount) {
  return typeof amount === "string" && amount !== "0" && !amount.startsWith("-");
}

function nftEntry(transfer, direction) {
  return {
    assetType: transfer.standard === "ERC1155" ? "ERC1155" : "ERC721",
    contractAddress: transfer.contractAddress,
    tokenId: transfer.tokenId,
    quantity: transfer.quantity || "1",
    direction,
    counterparty: direction === "OUT" ? transfer.to : transfer.from,
    logIndex: transfer.logIndex ?? null,
    batchIndex: transfer.batchIndex ?? null,
  };
}

/**
 * Reconstruct the transaction from the sender wallet's perspective.
 * This is deliberately descriptive rather than interpretive: it groups what
 * entered and left the wallet, while leaving purchase/sale/mint/gift meaning
 * to a later detector that has independent evidence for that conclusion.
 */
export function reconstructWalletActivity({ tx, assetFlows, nftTransfers = [] }) {
  const perspectiveAddress = tx?.from || assetFlows?.perspectiveAddress || null;
  const assetsIn = Array.isArray(assetFlows?.assetsIn) ? assetFlows.assetsIn : [];
  const assetsOut = Array.isArray(assetFlows?.assetsOut) ? assetFlows.assetsOut : [];
  const nftIn = [];
  const nftOut = [];
  const backgroundNftMovements = [];

  for (const transfer of Array.isArray(nftTransfers) ? nftTransfers : []) {
    const isIn = sameAddress(transfer?.to, perspectiveAddress);
    const isOut = sameAddress(transfer?.from, perspectiveAddress);
    if (isIn && !isOut) nftIn.push(nftEntry(transfer, "IN"));
    else if (isOut && !isIn) nftOut.push(nftEntry(transfer, "OUT"));
    else if (!isIn && !isOut) backgroundNftMovements.push(nftEntry(transfer, "BACKGROUND"));
  }

  const nativeIn = assetsIn.filter((asset) => asset?.assetType === "NATIVE" && positiveAmount(asset.amount));
  const nativeOut = assetsOut.filter((asset) => asset?.assetType === "NATIVE" && positiveAmount(asset.amount));
  const fungibleIn = assetsIn.filter((asset) => asset?.assetType === "ERC20" && positiveAmount(asset.amount));
  const fungibleOut = assetsOut.filter((asset) => asset?.assetType === "ERC20" && positiveAmount(asset.amount));

  return {
    perspectiveAddress,
    nativeIn,
    nativeOut,
    fungibleIn,
    fungibleOut,
    nftIn,
    nftOut,
    backgroundNftMovements,
    walletNftMovementCount: nftIn.length + nftOut.length,
    backgroundNftMovementCount: backgroundNftMovements.length,
    evidenceLimits: {
      economicMeaningProven: false,
      nftMovementDoesNotProvePurchaseSaleMintBurnOrGift: true,
      networkFeeExcluded: true,
    },
  };
}
