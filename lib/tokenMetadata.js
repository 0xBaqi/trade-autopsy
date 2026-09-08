import { rpcCall } from "./chains";

const DECIMALS_SELECTOR = "0x313ce567"; // decimals()
const SYMBOL_SELECTOR = "0x95d89b41"; // symbol()
const UINT256_HEX = /^[0-9a-fA-F]{64}$/;
const MAX_SYMBOL_BYTES = 64;

function decodeUint256Result(result) {
  if (typeof result !== "string" || !result.startsWith("0x")) return null;
  const hex = result.slice(2);
  if (!UINT256_HEX.test(hex)) return null;

  try {
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}

function decodeUtf8(hex) {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;

  try {
    const bytePairs = hex.match(/.{2}/g);
    if (!bytePairs) return null;
    const bytes = Uint8Array.from(bytePairs.map((byte) => parseInt(byte, 16)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function cleanSymbol(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\0/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length <= MAX_SYMBOL_BYTES ? cleaned : null;
}

function decodeBytes32Symbol(hex) {
  const bytes = hex.match(/.{2}/g);
  if (!bytes || bytes.length !== 32) return null;

  const firstNullByte = bytes.indexOf("00");
  const contentBytes = firstNullByte === -1 ? bytes : bytes.slice(0, firstNullByte);
  if (contentBytes.length === 0) return null;

  return cleanSymbol(decodeUtf8(contentBytes.join("")));
}

function decodeSymbolResult(result) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) return null;
  const hex = result.slice(2);

  if (hex.length === 64) {
    return decodeBytes32Symbol(hex);
  }

  if (hex.length < 128 || hex.length % 2 !== 0) return null;

  try {
    const offsetBytes = BigInt(`0x${hex.slice(0, 64)}`);
    if (offsetBytes > BigInt(Number.MAX_SAFE_INTEGER)) return null;

    const offset = Number(offsetBytes) * 2;
    if (offset < 64 || offset + 64 > hex.length) return null;

    const lengthBytes = BigInt(`0x${hex.slice(offset, offset + 64)}`);
    if (lengthBytes > BigInt(MAX_SYMBOL_BYTES)) return null;

    const byteLength = Number(lengthBytes);
    const start = offset + 64;
    const end = start + byteLength * 2;
    if (end > hex.length) return null;

    return cleanSymbol(decodeUtf8(hex.slice(start, end)));
  } catch {
    return null;
  }
}

async function safeEthCall(chain, to, data, blockTag) {
  try {
    return await rpcCall(chain, "eth_call", [{ to, data }, blockTag]);
  } catch {
    return null;
  }
}

async function readMetadata(chain, tokenAddress, blockTag) {
  const [decimalsResult, symbolResult] = await Promise.all([
    safeEthCall(chain, tokenAddress, DECIMALS_SELECTOR, blockTag),
    safeEthCall(chain, tokenAddress, SYMBOL_SELECTOR, blockTag),
  ]);

  const decodedDecimals = decodeUint256Result(decimalsResult);
  const decimals = decodedDecimals !== null && decodedDecimals <= 255n ? Number(decodedDecimals) : null;
  const symbol = decodeSymbolResult(symbolResult);
  return { symbol, decimals };
}

export async function resolveTokenMetadata(chain, tokenAddress, blockTag) {
  // Prefer metadata at the transaction block. Some public RPCs do not retain
  // historical state, though, which used to make otherwise normal swaps read
  // as "a token for a token". If either field is unavailable historically,
  // retry at latest and fill only the missing field. Amounts remain grounded
  // in the transaction's raw Transfer values; this fallback affects labels and
  // decimal formatting only and never invents metadata.
  const historical = await readMetadata(chain, tokenAddress, blockTag);
  if (historical.symbol !== null && historical.decimals !== null) return historical;

  const latest = await readMetadata(chain, tokenAddress, "latest");
  return {
    symbol: historical.symbol ?? latest.symbol,
    decimals: historical.decimals ?? latest.decimals,
  };
}

export function formatTokenAmount(rawAmount, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;

  try {
    const value = BigInt(rawAmount);
    if (decimals === 0) return value.toString();

    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const fraction = value % divisor;
    const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");

    return fractionText ? `${whole}.${fractionText}` : whole.toString();
  } catch {
    return null;
  }
}
