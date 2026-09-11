const SEAPORT_1_6_BY_CHAIN = new Map([
  ["ethereum", new Set(["0x0000000000000068f116a894984e2db1123eb395"])],
]);

export const SEAPORT_ORDER_FULFILLED_TOPIC = "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31";

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function positiveNftCount(list) {
  return Array.isArray(list) ? list.length : 0;
}

function paymentAssets(list) {
  return (Array.isArray(list) ? list : []).filter((asset) => {
    if (asset?.assetType !== "NATIVE" && asset?.assetType !== "ERC20") return false;
    try { return BigInt(asset?.rawAmount ?? "0") > 0n; }
    catch { return false; }
  });
}

function verifiedSeaportFulfillmentLogs(receipt, chainId) {
  const allowed = SEAPORT_1_6_BY_CHAIN.get(chainId);
  if (!allowed) return [];
  return (receipt?.logs || []).filter((log) => {
    const address = typeof log?.address === "string" ? log.address.toLowerCase() : null;
    const topic0 = Array.isArray(log?.topics) ? log.topics[0]?.toLowerCase() : null;
    return address && allowed.has(address) && topic0 === SEAPORT_ORDER_FULFILLED_TOPIC;
  });
}

/**
 * Classifies a sender-perspective NFT purchase/sale only when three independent
 * facts agree:
 * 1) a successful OrderFulfilled event came from a chain-verified Seaport contract;
 * 2) exactly one positive-quantity NFT movement involves the sender wallet; and
 * 3) consideration moved in the economically opposite direction.
 *
 * This deliberately refuses ambiguous bundles and transactions that merely
 * contain an NFT movement plus money with no marketplace fulfillment evidence.
 */
export function detectSeaportMarketplaceTrade({ receipt, chainId, walletActivity }) {
  if (receipt?.status !== "0x1") return null;

  const fulfillments = verifiedSeaportFulfillmentLogs(receipt, chainId);
  if (fulfillments.length !== 1) return null;

  const nftIn = walletActivity?.nftIn || [];
  const nftOut = walletActivity?.nftOut || [];
  const incomingNfts = positiveNftCount(nftIn);
  const outgoingNfts = positiveNftCount(nftOut);
  const moneyIn = paymentAssets([...(walletActivity?.nativeIn || []), ...(walletActivity?.fungibleIn || [])]);
  const moneyOut = paymentAssets([...(walletActivity?.nativeOut || []), ...(walletActivity?.fungibleOut || [])]);

  const purchase = incomingNfts === 1 && outgoingNfts === 0 && moneyOut.length === 1 && moneyIn.length === 0;
  const sale = outgoingNfts === 1 && incomingNfts === 0 && moneyIn.length === 1;
  if (!purchase && !sale) return null;

  const nft = purchase ? nftIn[0] : nftOut[0];
  const payment = purchase ? moneyOut[0] : moneyIn[0];
  const log = fulfillments[0];
  const logIndex = typeof log?.logIndex === "string" && /^0x[0-9a-fA-F]+$/.test(log.logIndex)
    ? Number.parseInt(log.logIndex, 16)
    : Number.isInteger(log?.logIndex) ? log.logIndex : null;

  return {
    type: purchase ? "NFT_PURCHASE" : "NFT_SALE",
    confidence: "HIGH",
    reason: purchase
      ? "A chain-verified Seaport OrderFulfilled event, one NFT entering the sender wallet, and one payment asset leaving together prove a marketplace purchase."
      : "A chain-verified Seaport OrderFulfilled event, one NFT leaving the sender wallet, and payment entering the sender wallet together prove a marketplace sale.",
    marketplace: {
      protocol: "SEAPORT",
      version: "1.6",
      contractAddress: log.address,
      logIndex,
      nft,
      payment,
      paymentPerspective: purchase ? "PAID_BY_SENDER" : "RECEIVED_BY_SENDER_NET",
      evidenceLimits: {
        singleFulfillmentOnly: true,
        bundledOrdersUnsupported: true,
        salePaymentIsSenderNetReceipt: sale,
      },
    },
  };
}
