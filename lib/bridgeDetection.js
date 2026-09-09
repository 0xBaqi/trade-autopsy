// Across V3 origin-side bridge evidence.
// We deliberately decode only the legacy EVM V3FundsDeposited event here.
// Newer Across FundsDeposited(bytes32...) support can be added separately.

// keccak256("V3FundsDeposited(address,address,uint256,uint256,uint256,uint32,uint32,uint32,uint32,address,address,address,bytes)")
const ACROSS_V3_FUNDS_DEPOSITED_TOPIC =
  "0xa123dc29aebf7d0c3322c8eeb5b999e859f39937950ed31056532713d0de396f";

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function addressFromWord(word) {
  if (!/^[0-9a-fA-F]{64}$/.test(word || "")) return null;
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

/**
 * Decode origin-side Across V3FundsDeposited evidence conservatively.
 *
 * Indexed topics after topic0:
 *   destinationChainId, depositId, depositor
 *
 * Non-indexed data words before dynamic message bytes:
 *   0 inputToken
 *   1 outputToken
 *   2 inputAmount
 *   3 outputAmount
 *   4 quoteTimestamp
 *   5 fillDeadline
 *   6 exclusivityDeadline
 *   7 recipient
 *   8 exclusiveRelayer
 *   9 message offset
 *
 * This proves bridge initiation only. It does NOT prove destination fill.
 */
export function detectAcrossBridgeDeposit({ tx, receipt, assetFlows }) {
  if (receipt?.status !== "0x1") return null;
  const sender = normalizeAddress(tx?.from);
  if (!sender) return null;

  for (const log of receipt?.logs || []) {
    if (!Array.isArray(log?.topics) || log.topics.length !== 4) continue;
    if (log.topics[0]?.toLowerCase() !== ACROSS_V3_FUNDS_DEPOSITED_TOPIC) continue;

    const destinationChainId = uintFromWord(log.topics[1]?.slice(2));
    const depositId = uintFromWord(log.topics[2]?.slice(2));
    const depositor = addressFromWord(log.topics[3]?.slice(2));
    const words = dataWords(log.data);
    if (destinationChainId === null || depositId === null || !depositor || !words || words.length < 10) continue;

    const inputToken = addressFromWord(words[0]);
    const outputToken = addressFromWord(words[1]);
    const inputAmount = uintFromWord(words[2]);
    const outputAmount = uintFromWord(words[3]);
    const quoteTimestamp = uintFromWord(words[4]);
    const fillDeadline = uintFromWord(words[5]);
    const exclusivityDeadline = uintFromWord(words[6]);
    const recipient = addressFromWord(words[7]);
    const exclusiveRelayer = addressFromWord(words[8]);
    const messageOffset = uintFromWord(words[9]);
    if (
      !inputToken || !outputToken || inputAmount === null || outputAmount === null ||
      quoteTimestamp === null || fillDeadline === null || exclusivityDeadline === null ||
      !recipient || !exclusiveRelayer || messageOffset === null
    ) continue;

    // Dynamic ABI offset must be word-aligned and point inside the data payload.
    if (messageOffset % 32n !== 0n || messageOffset > BigInt((log.data.length - 2) / 2)) continue;

    // First slice only: describe deposits initiated by the transaction sender.
    if (depositor !== sender) continue;

    // Event signature alone is insufficient. Require matching wallet-side ERC-20
    // outflow for the exact input token and amount.
    if (!findSenderOutflow(assetFlows, inputToken, inputAmount.toString())) continue;

    return {
      type: "BRIDGE",
      confidence: "HIGH",
      reason: "A successful Across V3 deposit event identifies a destination chain and recipient, and sender-side evidence corroborates the exact deposited token amount leaving the wallet.",
      bridge: {
        protocol: "ACROSS",
        stage: "INITIATED",
        source: "V3FundsDeposited",
        spokePool: normalizeAddress(log.address),
        destinationChainId: destinationChainId.toString(),
        depositId: depositId.toString(),
        depositor,
        recipient,
        inputToken,
        outputToken,
        inputRawAmount: inputAmount.toString(),
        outputRawAmount: outputAmount.toString(),
        quoteTimestamp: quoteTimestamp.toString(),
        fillDeadline: fillDeadline.toString(),
        exclusivityDeadline: exclusivityDeadline.toString(),
        exclusiveRelayer,
        destinationFillVerified: false,
        coverage: assetFlows?.coverage || null,
      },
    };
  }

  return null;
}
