const SEAPORT_1_6_BY_CHAIN = new Map([
  ["ethereum", new Set(["0x0000000000000068f116a894984e2db1123eb395"])],
]);

export const SEAPORT_ORDER_FULFILLED_TOPIC = "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function logIndexOf(log) {
  if (typeof log?.logIndex === "string" && /^0x[0-9a-fA-F]+$/.test(log.logIndex)) return Number.parseInt(log.logIndex, 16);
  return Number.isInteger(log?.logIndex) ? log.logIndex : null;
}

function strip0x(value) {
  return typeof value === "string" && value.startsWith("0x") ? value.slice(2) : value;
}

function wordAt(hex, byteOffset) {
  const start = byteOffset * 2;
  const word = hex.slice(start, start + 64);
  return word.length === 64 ? word : null;
}

function uintWord(word) {
  if (!word || !/^[0-9a-fA-F]{64}$/.test(word)) return null;
  try { return BigInt(`0x${word}`); }
  catch { return null; }
}

function addressWord(word) {
  if (!word || !/^[0-9a-fA-F]{64}$/.test(word)) return null;
  return `0x${word.slice(24)}`.toLowerCase();
}

function addressTopic(topic) {
  const hex = strip0x(topic);
  return typeof hex === "string" && /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex.slice(24)}`.toLowerCase() : null;
}

function decodeStaticTupleArray(hex, byteOffset, tupleWords, includeRecipient) {
  const lengthWord = wordAt(hex, byteOffset);
  const lengthBig = uintWord(lengthWord);
  if (lengthBig == null || lengthBig > 64n) return null;
  const length = Number(lengthBig);
  const items = [];
  for (let i = 0; i < length; i += 1) {
    const base = byteOffset + 32 + i * tupleWords * 32;
    const itemTypeBig = uintWord(wordAt(hex, base));
    const token = addressWord(wordAt(hex, base + 32));
    const identifierBig = uintWord(wordAt(hex, base + 64));
    const amountBig = uintWord(wordAt(hex, base + 96));
    if (itemTypeBig == null || token == null || identifierBig == null || amountBig == null || itemTypeBig > 255n) return null;
    const item = {
      itemType: Number(itemTypeBig),
      token,
      identifier: identifierBig.toString(),
      rawAmount: amountBig.toString(),
    };
    if (includeRecipient) {
      const recipient = addressWord(wordAt(hex, base + 128));
      if (!recipient) return null;
      item.recipient = recipient;
    }
    items.push(item);
  }
  return items;
}

function decodeOrderFulfilled(log) {
  const dataHex = strip0x(log?.data);
  const topics = Array.isArray(log?.topics) ? log.topics : [];
  if (typeof dataHex !== "string" || !/^[0-9a-fA-F]+$/.test(dataHex) || dataHex.length < 256 || topics.length < 3) return null;

  const orderHashWord = wordAt(dataHex, 0);
  const recipient = addressWord(wordAt(dataHex, 32));
  const offerOffsetBig = uintWord(wordAt(dataHex, 64));
  const considerationOffsetBig = uintWord(wordAt(dataHex, 96));
  if (!orderHashWord || !recipient || offerOffsetBig == null || considerationOffsetBig == null) return null;
  if (offerOffsetBig > BigInt(Number.MAX_SAFE_INTEGER) || considerationOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const offer = decodeStaticTupleArray(dataHex, Number(offerOffsetBig), 4, false);
  const consideration = decodeStaticTupleArray(dataHex, Number(considerationOffsetBig), 5, true);
  if (!offer || !consideration) return null;

  return {
    orderHash: `0x${orderHashWord}`.toLowerCase(),
    offerer: addressTopic(topics[1]),
    zone: addressTopic(topics[2]),
    recipient,
    offer,
    consideration,
    logIndex: logIndexOf(log),
  };
}

function isNftItem(item) {
  return item?.itemType === 2 || item?.itemType === 3 || item?.itemType === 4 || item?.itemType === 5;
}

function isPaymentItem(item) {
  return item?.itemType === 0 || item?.itemType === 1;
}

function nftMatchesWalletItem(eventItem, walletItem) {
  if (!eventItem || !walletItem || !isNftItem(eventItem)) return false;
  const eventStandard = eventItem.itemType === 3 || eventItem.itemType === 5 ? "ERC1155" : "ERC721";
  return eventStandard === (walletItem.standard || walletItem.assetType)
    && eventItem.token === walletItem.contractAddress?.toLowerCase()
    && eventItem.identifier === String(walletItem.tokenId)
    && eventItem.rawAmount === String(walletItem.quantity || "1");
}

function paymentKey(item) {
  if (!isPaymentItem(item)) return null;
  return item.itemType === 0 ? "NATIVE" : `ERC20:${item.token}`;
}

function summarizePaymentItems(items) {
  const payments = items.filter(isPaymentItem);
  if (!payments.length) return null;
  const key = paymentKey(payments[0]);
  if (!key || payments.some((item) => paymentKey(item) !== key)) return null;
  let total = 0n;
  for (const item of payments) {
    try { total += BigInt(item.rawAmount); }
    catch { return null; }
  }
  return { key, rawAmount: total.toString(), itemType: payments[0].itemType, token: payments[0].token };
}

function aggregateDecodedPayments(orders) {
  if (!orders.length) return null;
  const key = orders[0].payment.key;
  if (orders.some((order) => order.payment.key !== key)) return null;
  let total = 0n;
  for (const order of orders) total += BigInt(order.payment.rawAmount);
  return { ...orders[0].payment, rawAmount: total.toString() };
}

function walletPaymentMatches(decodedPayment, walletPayment) {
  if (!decodedPayment || !walletPayment) return false;
  if (decodedPayment.rawAmount !== String(walletPayment.rawAmount ?? "")) return false;
  if (decodedPayment.key === "NATIVE") return walletPayment.assetType === "NATIVE";
  const token = decodedPayment.token?.toLowerCase();
  const walletToken = walletPayment.contractAddress?.toLowerCase() || walletPayment.tokenAddress?.toLowerCase() || null;
  return walletPayment.assetType === "ERC20" && (!walletToken || walletToken === token);
}

function decodeMultiFulfillmentTrade({ fulfillments, nftIn, nftOut, moneyIn, moneyOut }) {
  const decoded = fulfillments.map(decodeOrderFulfilled);
  if (decoded.some((entry) => !entry)) return null;

  const purchase = nftIn.length === decoded.length && nftIn.length >= 2 && nftOut.length === 0 && moneyOut.length === 1 && moneyIn.length === 0;
  const sale = nftOut.length === decoded.length && nftOut.length >= 2 && nftIn.length === 0 && moneyIn.length === 1;
  if (!purchase && !sale) return null;

  const walletNfts = purchase ? nftIn : nftOut;
  const usedWalletIndexes = new Set();
  const orders = [];

  for (const fulfillment of decoded) {
    const nftSide = purchase ? fulfillment.offer : fulfillment.consideration;
    const oppositeSide = purchase ? fulfillment.consideration : fulfillment.offer;
    const relevantNfts = nftSide.filter(isNftItem);
    const oppositeNfts = oppositeSide.filter(isNftItem);
    if (relevantNfts.length !== 1 || oppositeNfts.length !== 0) return null;

    const matchIndexes = walletNfts
      .map((walletNft, index) => nftMatchesWalletItem(relevantNfts[0], walletNft) ? index : -1)
      .filter((index) => index >= 0 && !usedWalletIndexes.has(index));
    if (matchIndexes.length !== 1) return null;
    const walletIndex = matchIndexes[0];
    usedWalletIndexes.add(walletIndex);

    const payment = summarizePaymentItems(oppositeSide);
    if (!payment || payment.rawAmount === "0") return null;

    orders.push({
      orderHash: fulfillment.orderHash,
      logIndex: fulfillment.logIndex,
      offerer: fulfillment.offerer,
      recipient: fulfillment.recipient,
      nft: walletNfts[walletIndex],
      payment,
    });
  }

  if (usedWalletIndexes.size !== walletNfts.length) return null;
  const aggregatePayment = aggregateDecodedPayments(orders);
  const walletPayment = purchase ? moneyOut[0] : moneyIn[0];
  if (!aggregatePayment || !walletPaymentMatches(aggregatePayment, walletPayment)) return null;

  return { purchase, sale, orders, walletNfts, walletPayment, aggregatePayment };
}

/**
 * Classifies sender-perspective Seaport purchases/sales only when independent
 * marketplace, NFT-direction, and consideration-direction evidence agree.
 *
 * P2W supports either one verified fulfillment or a conservative multi-order
 * bundle where every fulfillment decodes cleanly, maps one-to-one to one wallet
 * NFT movement, uses a single payment asset, and the decoded aggregate payment
 * exactly matches the wallet-level payment evidence.
 */
export function detectSeaportMarketplaceTrade({ receipt, chainId, walletActivity }) {
  if (receipt?.status !== "0x1") return null;

  const fulfillments = verifiedSeaportFulfillmentLogs(receipt, chainId);
  if (!fulfillments.length) return null;

  const nftIn = walletActivity?.nftIn || [];
  const nftOut = walletActivity?.nftOut || [];
  const incomingNfts = positiveNftCount(nftIn);
  const outgoingNfts = positiveNftCount(nftOut);
  const moneyIn = paymentAssets([...(walletActivity?.nativeIn || []), ...(walletActivity?.fungibleIn || [])]);
  const moneyOut = paymentAssets([...(walletActivity?.nativeOut || []), ...(walletActivity?.fungibleOut || [])]);

  if (fulfillments.length > 1) {
    const bundle = decodeMultiFulfillmentTrade({ fulfillments, nftIn, nftOut, moneyIn, moneyOut });
    if (!bundle) return null;
    const { purchase, orders, walletNfts, walletPayment } = bundle;
    return {
      type: purchase ? "NFT_PURCHASE" : "NFT_SALE",
      confidence: "HIGH",
      reason: purchase
        ? `${orders.length} chain-verified Seaport OrderFulfilled events decode into ${walletNfts.length} one-to-one NFT purchases whose aggregate consideration exactly matches the payment leaving the sender wallet.`
        : `${orders.length} chain-verified Seaport OrderFulfilled events decode into ${walletNfts.length} one-to-one NFT sales whose aggregate gross consideration exactly matches the payment entering the sender wallet.`,
      marketplace: {
        protocol: "SEAPORT",
        version: "1.6",
        contractAddress: fulfillments[0].address,
        logIndex: logIndexOf(fulfillments[0]),
        nft: walletNfts[0],
        nfts: walletNfts,
        nftCount: walletNfts.length,
        bundled: true,
        fulfillmentCount: orders.length,
        orders,
        payment: walletPayment,
        paymentPerspective: purchase ? "PAID_BY_SENDER" : "RECEIVED_BY_SENDER_GROSS",
        evidenceLimits: {
          singleFulfillmentOnly: false,
          bundledOrdersUnsupported: false,
          perNftPriceAllocationUnsupported: false,
          multipleFulfillmentsUnsupported: false,
          mixedDirectionNftsUnsupported: true,
          mixedPaymentAssetsUnsupported: true,
          salePaymentIsGrossIncomingTransfer: !purchase,
        },
      },
    };
  }

  const purchase = incomingNfts >= 1 && outgoingNfts === 0 && moneyOut.length === 1 && moneyIn.length === 0;
  const sale = outgoingNfts >= 1 && incomingNfts === 0 && moneyIn.length === 1;
  if (!purchase && !sale) return null;

  const nfts = purchase ? nftIn : nftOut;
  const payment = purchase ? moneyOut[0] : moneyIn[0];
  const bundled = nfts.length > 1;
  const log = fulfillments[0];

  return {
    type: purchase ? "NFT_PURCHASE" : "NFT_SALE",
    confidence: "HIGH",
    reason: purchase
      ? `A chain-verified Seaport OrderFulfilled event, ${nfts.length} NFT${bundled ? "s" : ""} entering the sender wallet, and one payment asset leaving together prove a marketplace purchase${bundled ? " bundle" : ""}.`
      : `A chain-verified Seaport OrderFulfilled event, ${nfts.length} NFT${bundled ? "s" : ""} leaving the sender wallet, and payment entering the sender wallet together prove a marketplace sale${bundled ? " bundle" : ""}.`,
    marketplace: {
      protocol: "SEAPORT",
      version: "1.6",
      contractAddress: log.address,
      logIndex: logIndexOf(log),
      nft: nfts[0],
      nfts,
      nftCount: nfts.length,
      bundled,
      payment,
      paymentPerspective: purchase ? "PAID_BY_SENDER" : "RECEIVED_BY_SENDER_GROSS",
      evidenceLimits: {
        singleFulfillmentOnly: true,
        bundledOrdersUnsupported: false,
        perNftPriceAllocationUnsupported: bundled,
        multipleFulfillmentsUnsupported: true,
        mixedDirectionNftsUnsupported: true,
        salePaymentIsGrossIncomingTransfer: sale,
      },
    },
  };
}