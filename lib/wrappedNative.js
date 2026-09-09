// Canonical wrapped-native contracts for chains Trade Autopsy can identify safely.
// Keep this registry explicit rather than guessing token identity from symbols.
const WRAPPED_NATIVE_BY_CHAIN = new Map([
  [1, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"], // WETH
  [56, "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"], // WBNB
  [8453, "0x4200000000000000000000000000000000000006"], // WETH
  [10, "0x4200000000000000000000000000000000000006"], // WETH
  [42161, "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"], // WETH
]);

export function wrappedNativeAddress(chainId) {
  const numericId = Number(chainId);
  return Number.isFinite(numericId) ? WRAPPED_NATIVE_BY_CHAIN.get(numericId) || null : null;
}

export function isWrappedNative(chainId, tokenAddress) {
  if (typeof tokenAddress !== "string") return false;
  const wrapped = wrappedNativeAddress(chainId);
  return Boolean(wrapped && wrapped === tokenAddress.toLowerCase());
}
