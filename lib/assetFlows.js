import { formatTokenAmount } from "./tokenMetadata";

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function positiveBigInt(value) {
  try {
    const parsed = BigInt(value || "0");
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function tokenKey(tokenAddress) {
  return `token:${tokenAddress.toLowerCase()}`;
}

function makeTokenAsset(transfer, rawAmount) {
  return {
    assetType: "ERC20",
    tokenAddress: transfer.tokenAddress,
    symbol: transfer.symbol ?? null,
    decimals: Number.isInteger(transfer.decimals) ? transfer.decimals : null,
    rawAmount: rawAmount.toString(),
    amount: Number.isInteger(transfer.decimals)
      ? formatTokenAmount(rawAmount.toString(), transfer.decimals)
      : null,
  };
}

function makeNativeAsset(chain, rawAmount) {
  return {
    assetType: "NATIVE",
    tokenAddress: null,
    symbol: chain.symbol,
    decimals: 18,
    rawAmount: rawAmount.toString(),
    amount: formatTokenAmount(rawAmount.toString(), 18),
  };
}

function addAmount(map, key, rawAmount, template) {
  const existing = map.get(key);
  if (existing) {
    existing.rawAmount += rawAmount;
    return;
  }

  map.set(key, { rawAmount, template });
}

function materializeMap(map, chain) {
  return [...map.values()].map(({ rawAmount, template }) =>
    template.assetType === "NATIVE"
      ? makeNativeAsset(chain, rawAmount)
      : makeTokenAsset(template, rawAmount)
  );
}

function signedAmount(rawAmount, decimals) {
  if (!Number.isInteger(decimals)) return null;
  if (rawAmount === 0n) return "0";

  const absolute = rawAmount < 0n ? -rawAmount : rawAmount;
  const formatted = formatTokenAmount(absolute.toString(), decimals);
  if (formatted === null) return null;
  return rawAmount < 0n ? `-${formatted}` : formatted;
}

/**
 * Reconstruct asset changes from the transaction sender's perspective.
 *
 * Coverage is deliberately limited to the top-level native value and the
 * ERC-20 Transfer logs already decoded by Trade Autopsy. Internal native
 * transfers require trace data and are not inferred here.
 */
export function reconstructAssetFlows({ tx, receipt, chain, tokenTransfers = [] }) {
  const perspectiveAddress = tx?.from || null;
  const success = receipt?.status === "0x1";
  const incoming = new Map();
  const outgoing = new Map();
  const net = new Map();

  if (!perspectiveAddress || !success) {
    return {
      perspectiveAddress,
      assetsIn: [],
      assetsOut: [],
      netChanges: [],
      coverage: "TOP_LEVEL_NATIVE_AND_ERC20_LOGS",
    };
  }

  const nativeValue = positiveBigInt(tx?.value);
  if (nativeValue > 0n) {
    const key = `native:${chain.id}`;
    const template = { assetType: "NATIVE" };
    addAmount(outgoing, key, nativeValue, template);
    net.set(key, { rawAmount: -nativeValue, template });
  }

  for (const transfer of Array.isArray(tokenTransfers) ? tokenTransfers : []) {
    if (!transfer?.tokenAddress) continue;

    const rawAmount = positiveBigInt(transfer.rawAmount);
    if (rawAmount === 0n) continue;

    const key = tokenKey(transfer.tokenAddress);
    const isOut = sameAddress(transfer.from, perspectiveAddress);
    const isIn = sameAddress(transfer.to, perspectiveAddress);

    if (!isOut && !isIn) continue;

    if (isOut) addAmount(outgoing, key, rawAmount, transfer);
    if (isIn) addAmount(incoming, key, rawAmount, transfer);

    const current = net.get(key) || { rawAmount: 0n, template: transfer };
    current.rawAmount += (isIn ? rawAmount : 0n) - (isOut ? rawAmount : 0n);
    net.set(key, current);
  }

  const netChanges = [...net.values()].map(({ rawAmount, template }) => {
    const asset = template.assetType === "NATIVE"
      ? makeNativeAsset(chain, rawAmount < 0n ? -rawAmount : rawAmount)
      : makeTokenAsset(template, rawAmount < 0n ? -rawAmount : rawAmount);

    const decimals = asset.decimals;
    return {
      ...asset,
      rawAmount: rawAmount.toString(),
      amount: signedAmount(rawAmount, decimals),
      direction: rawAmount > 0n ? "IN" : rawAmount < 0n ? "OUT" : "FLAT",
    };
  });

  return {
    perspectiveAddress,
    assetsIn: materializeMap(incoming, chain),
    assetsOut: materializeMap(outgoing, chain),
    netChanges,
    coverage: "TOP_LEVEL_NATIVE_AND_ERC20_LOGS",
  };
}
