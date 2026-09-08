const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const ERC20_TRANSFER_FROM_SELECTOR = "0x23b872dd";

function normalizeInput(input) {
  if (typeof input !== "string") return "0x";
  return input.toLowerCase();
}

function hasCalldata(input) {
  return input !== "0x" && input !== "0x0" && input.length > 2;
}

function selectorOf(input) {
  return input.length >= 10 ? input.slice(0, 10) : null;
}

function hasPositiveNativeValue(valueHex) {
  try {
    return BigInt(valueHex || "0x0") > 0n;
  } catch {
    return false;
  }
}

/**
 * Conservative, deterministic first-pass transaction classification.
 *
 * This intentionally does not infer swaps, bridges, approvals, NFT actions,
 * or protocol-specific behavior. A classification is emitted only when the
 * transaction shape gives us strong evidence for the label.
 */
export function classifyTransaction({ tx, receipt, tokenTransfers = [] }) {
  const success = receipt?.status === "0x1";
  const input = normalizeInput(tx?.input);
  const selector = selectorOf(input);
  const nativeValueSent = hasPositiveNativeValue(tx?.value);
  const transferCount = Array.isArray(tokenTransfers) ? tokenTransfers.length : 0;

  if (!success) {
    return {
      type: "FAILED_TRANSACTION",
      confidence: "HIGH",
      reason: "The transaction receipt reports a failed/reverted status.",
    };
  }

  if (tx?.to === null || tx?.to === undefined) {
    return {
      type: "CONTRACT_CREATION",
      confidence: "HIGH",
      reason: "The transaction has no recipient address, which is the EVM shape for contract creation.",
    };
  }

  if (
    transferCount > 0 &&
    (selector === ERC20_TRANSFER_SELECTOR || selector === ERC20_TRANSFER_FROM_SELECTOR)
  ) {
    return {
      type: "ERC20_TRANSFER",
      confidence: "HIGH",
      reason: `The call uses the ERC-20 ${selector === ERC20_TRANSFER_SELECTOR ? "transfer" : "transferFrom"} selector and emitted ERC-20-shaped Transfer evidence.`,
    };
  }

  if (!hasCalldata(input) && nativeValueSent && transferCount === 0) {
    return {
      type: "NATIVE_TRANSFER",
      confidence: "HIGH",
      reason: "The transaction sends native value with no calldata and emitted no ERC-20-shaped Transfer events.",
    };
  }

  if (hasCalldata(input)) {
    return {
      type: "CONTRACT_INTERACTION",
      confidence: "HIGH",
      reason: "The transaction contains calldata but does not match a stronger supported classification.",
    };
  }

  return {
    type: "UNKNOWN",
    confidence: "LOW",
    reason: "The available deterministic evidence does not support a more specific classification.",
  };
}
