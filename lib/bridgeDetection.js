// Across V3 origin-side bridge evidence.
// We deliberately decode only the legacy EVM V3FundsDeposited event here.
// Newer Across FundsDeposited(bytes32...) support can be added separately.

const ACROSS_V3_FUNDS_DEPOSITED_TOPIC =
  "0xa123dc29aebbe5f2b0a65ef7c2c26b9c4a8f5b4d33a8e3dbb2b95f1e6d0e7f7c";

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
 * Event ABI:
 * V3FundsDeposited(
 *   address inputToken,
 *   address outputToken,
 *   uint256 inputAmount,
 *   uint256 outputAmount,
 *   uint256 indexed destinationChainId,
 *   uint32 indexed depositId,
 *   uint32 quoteTimestamp,
 *   uint32 fillDeadline,
 *   uint32 exclusivityDeadline,
 *   address indexed depositor,
 *   address recipient,
 *   address exclusiveRelayer,
 *   bytes message
 * )
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
    if (destinationChainId === null || depositId === null || !depositor || !words || words.length < 9) continue;

    const inputToken = addressFromWord(words[0]);
    const outputToken = addressFromWord(words[1]);
    const inputAmount = uintFromWord(words[2]);
    const outputAmount = uintFromWord(words[3]);
    const recipient = addressFromWord(words[7]);
    const exclusiveRelayer = addressFromWord(words[8]);
    if (!inputToken || !outputToken || inputAmount === null || outputAmount === null || !recipient) continue;

    // For the first slice, only classify deposits initiated by the transaction sender.
    // This avoids describing delegated deposits as if the wallet itself were depositor.
    if (depositor !== sender) continue;

    // Corroborate the event against sender-side ERC-20 evidence. We do not trust an
    // event signature alone to describe wallet movement.
    if (!findSenderOutflow(assetFlows, inputToken, inputAmount.toString())) continue;

    return {
      type: "BRIDGE",
      confidence: "HIGH",
      reason: "A successful Across V3 deposit event identifies a destination chain and recipient, and the sender-side evidence corroborates the deposited token amount leaving the wallet.",
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
        exclusiveRelayer,
        destinationFillVerified: false,
        coverage: assetFlows?.coverage || null,
      },
    };
  }

  return null;
}
