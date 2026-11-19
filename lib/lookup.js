// Pull a transaction hash out of whatever the user pasted: a bare hash or an explorer link.
const HASH_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

export function extractTxHash(input) {
  const match = String(input ?? "").match(HASH_RE);
  return match ? match[0].toLowerCase() : null;
}

export function casePath(chainId, hash) {
  return `/tx/${encodeURIComponent(chainId)}/${hash.toLowerCase()}`;
}
