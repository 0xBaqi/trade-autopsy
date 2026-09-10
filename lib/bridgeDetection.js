// Across V3 origin-side bridge evidence.
// Supports both the legacy V3FundsDeposited(address...) event and the newer
// FundsDeposited(bytes32...) event used by current Across SpokePools.

const ACROSS_V3_FUNDS_DEPOSITED_TOPIC =
  "0xa123dc29aebf7d0c3322c8eeb5b999e859f39937950ed31056532713d0de396f";
const ACROSS_FUNDS_DEPOSITED_TOPIC =
  "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3";

// Bounded registry sourced from Across' canonical deployed-addresses.json.
// Add chains only after verifying the canonical Across deployment.
const ACROSS_SPOKE_POOLS = {
  ethereum: "0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5",
  arbitrum: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a",
};

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function logIndexOf(log) {
  if (Number.isInteger(log?.logIndex)) return log.logIndex;
  if (typeof log?.logIndex !== "string" || !/^0x[0-9a-fA-F]+$/.test(log.logIndex)) return null;
  const value = Number.parseInt(log.logIndex, 16);
  return Number.isSafeInteger(value) ? value : null;
}

function evmAddressFromWord(word) {
  if (!/^[0-9a-fA-F]{64}$/.test(word || "")) return null;
  if (!/^0{24}/.test(word)) return null;
  return `0x${word.slice(24).toLowerCase()}`;
}

function uintFromWord(word) {
  if (!/^[0-9a-fA-F]{64}$/.test(word || "")) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function dataWords(data) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const hex = data.slice(2);
  if (hex.length % 64 !== 0) return null;
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push(hex.slice(i, i + 64));
  return words;
}

function findSenderOutflow(assetFlows, tokenAddress, rawAmount) {
  const target = normalizeAddress(tokenAddress);
  return (assetFlows?.assetsOut || []).some((asset) =>
    asset?.assetType === "ERC20" &&
    normalizeAddress(asset.tokenAddress) === target &&
    String(asset.rawAmount) === String(rawAmount)
  );
}

function decodeAcrossDeposit(log, source) {
  const destinationChainId = uintFromWord(log.topics[1]?.slice(2));
  const depositId = uintFromWord(log.topics[2]?.slice(2));
  const depositor = evmAddressFromWord(log.topics[3]?.slice(2));
  const words = dataWords(log.data);
  if (destinationChainId === null || depositId === null || !depositor || !words || words.length < 10) return null;

  const inputToken = evmAddressFromWord(words[0]);
  const outputToken = evmAddressFromWord(words[1]);
  const inputAmount = uintFromWord(words[2]);
  const outputAmount = uintFromWord(words[3]);
  const quoteTimestamp = uintFromWord(words[4]);
  const fillDeadline = uintFromWord(words[5]);
  const exclusivityDeadline = uintFromWord(words[6]);
  const recipient = evmAddressFromWord(words[7]);
  const exclusiveRelayer = evmAddressFromWord(words[8]);
  const messageOffset = uintFromWord(words[9]);

  if (
    !inputToken || !outputToken || inputAmount === null || outputAmount === null ||
    quoteTimestamp === null || fillDeadline === null || exclusivityDeadline === null ||
    !recipient || !exclusiveRelayer || messageOffset === null
  ) return null;

  if (messageOffset % 32n !== 0n || messageOffset > BigInt((log.data.length - 2) / 2)) return null;

  return {
    source,
    destinationChainId,
    depositId,
    depositor,
    recipient,
    inputToken,
    outputToken,
    inputAmount,
    outputAmount,
    quoteTimestamp,
    fillDeadline,
    exclusivityDeadline,
    exclusiveRelayer,
  };
}

/**
 * Decode origin-side Across deposit evidence conservatively.
 * This proves bridge initiation only. It does NOT prove destination fill.
 * Modern bytes32 events are accepted only when their address-like fields are
 * valid zero-left-padded EVM addresses; non-EVM identifiers remain unsupported.
 */
export function detectAcrossBridgeDeposit({ tx, receipt, assetFlows, chainId }) {
  if (receipt?.status !== "0x1") return null;
  const sender = normalizeAddress(tx?.from);
  const verifiedSpokePool = ACROSS_SPOKE_POOLS[chainId];
  if (!sender || !verifiedSpokePool) return null;

  for (const log of receipt?.logs || []) {
    if (!Array.isArray(log?.topics) || log.topics.length !== 4) continue;
    if (normalizeAddress(log.address) !== verifiedSpokePool) continue;

    const topic0 = log.topics[0]?.toLowerCase();
    let source = null;
    if (topic0 === ACROSS_V3_FUNDS_DEPOSITED_TOPIC) source = "V3FundsDeposited";
    else if (topic0 === ACROSS_FUNDS_DEPOSITED_TOPIC) source = "FundsDeposited";
    else continue;

    const decoded = decodeAcrossDeposit(log, source);
    if (!decoded) continue;
    if (decoded.depositor !== sender) continue;
    if (!findSenderOutflow(assetFlows, decoded.inputToken, decoded.inputAmount.toString())) continue;

    return {
      type: "BRIDGE",
      confidence: "HIGH",
      reason: "A successful deposit event from the verified Across SpokePool identifies a destination chain and recipient, and sender-side evidence corroborates the exact deposited token amount leaving the wallet.",
      bridge: {
        protocol: "ACROSS",
        stage: "INITIATED",
        source: decoded.source,
        logIndex: logIndexOf(log),
        spokePool: verifiedSpokePool,
        destinationChainId: decoded.destinationChainId.toString(),
        depositId: decoded.depositId.toString(),
        depositor: decoded.depositor,
        recipient: decoded.recipient,
        inputToken: decoded.inputToken,
        outputToken: decoded.outputToken,
        inputRawAmount: decoded.inputAmount.toString(),
        outputRawAmount: decoded.outputAmount.toString(),
        quoteTimestamp: decoded.quoteTimestamp.toString(),
        fillDeadline: decoded.fillDeadline.toString(),
        exclusivityDeadline: decoded.exclusivityDeadline.toString(),
        exclusiveRelayer: decoded.exclusiveRelayer,
        destinationFillVerified: false,
        coverage: assetFlows?.coverage || null,
      },
    };
  }

  return null;
}
