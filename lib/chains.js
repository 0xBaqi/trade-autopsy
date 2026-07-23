export const CHAINS = [
  {
    id: "xlayer", name: "X Layer", symbol: "OKB",
    rpcs: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
    explorer: "https://www.oklink.com/xlayer/tx/",
  },
  {
    id: "ethereum", name: "Ethereum", symbol: "ETH",
    rpcs: ["https://eth.llamarpc.com", "https://cloudflare-eth.com", "https://rpc.ankr.com/eth", "https://ethereum-rpc.publicnode.com"],
    explorer: "https://etherscan.io/tx/",
  },
  {
    id: "bsc", name: "BNB Chain", symbol: "BNB",
    rpcs: ["https://bsc-dataseed.binance.org", "https://rpc.ankr.com/bsc", "https://bsc-rpc.publicnode.com"],
    explorer: "https://bscscan.com/tx/",
  },
  {
    id: "polygon", name: "Polygon", symbol: "POL",
    rpcs: ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon", "https://polygon-bor-rpc.publicnode.com"],
    explorer: "https://polygonscan.com/tx/",
  },
  {
    id: "arbitrum", name: "Arbitrum", symbol: "ETH",
    rpcs: ["https://arb1.arbitrum.io/rpc", "https://rpc.ankr.com/arbitrum", "https://arbitrum-one-rpc.publicnode.com"],
    explorer: "https://arbiscan.io/tx/",
  },
  {
    id: "base", name: "Base", symbol: "ETH",
    rpcs: ["https://mainnet.base.org", "https://rpc.ankr.com/base", "https://base-rpc.publicnode.com"],
    explorer: "https://basescan.org/tx/",
  },
  {
    id: "optimism", name: "Optimism", symbol: "ETH",
    rpcs: ["https://mainnet.optimism.io", "https://rpc.ankr.com/optimism", "https://optimism-rpc.publicnode.com"],
    explorer: "https://optimistic.etherscan.io/tx/",
  },
  {
    id: "zksync", name: "zkSync Era", symbol: "ETH",
    rpcs: ["https://mainnet.era.zksync.io", "https://zksync-era-rpc.publicnode.com"],
    explorer: "https://explorer.zksync.io/tx/",
  },
  {
    id: "linea", name: "Linea", symbol: "ETH",
    rpcs: ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"],
    explorer: "https://lineascan.build/tx/",
  },
  {
    id: "scroll", name: "Scroll", symbol: "ETH",
    rpcs: ["https://rpc.scroll.io", "https://scroll-rpc.publicnode.com"],
    explorer: "https://scrollscan.com/tx/",
  },
  {
    id: "blast", name: "Blast", symbol: "ETH",
    rpcs: ["https://rpc.blast.io", "https://blast-rpc.publicnode.com"],
    explorer: "https://blastscan.io/tx/",
  },
  {
    id: "mantle", name: "Mantle", symbol: "MNT",
    rpcs: ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com"],
    explorer: "https://mantlescan.xyz/tx/",
  },
  {
    id: "mode", name: "Mode", symbol: "ETH",
    rpcs: ["https://mainnet.mode.network"],
    explorer: "https://explorer.mode.network/tx/",
  },
  {
    id: "manta", name: "Manta Pacific", symbol: "ETH",
    rpcs: ["https://pacific-rpc.manta.network/http"],
    explorer: "https://pacific-explorer.manta.network/tx/",
  },
  {
    id: "zora", name: "Zora", symbol: "ETH",
    rpcs: ["https://rpc.zora.energy"],
    explorer: "https://explorer.zora.energy/tx/",
  },
  {
    id: "unichain", name: "Unichain", symbol: "ETH",
    rpcs: ["https://mainnet.unichain.org", "https://unichain-rpc.publicnode.com"],
    explorer: "https://uniscan.xyz/tx/",
  },
  {
    id: "avalanche", name: "Avalanche", symbol: "AVAX",
    rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"],
    explorer: "https://snowtrace.io/tx/",
  },
  {
    id: "gnosis", name: "Gnosis Chain", symbol: "xDAI",
    rpcs: ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"],
    explorer: "https://gnosisscan.io/tx/",
  },
  {
    id: "opbnb", name: "opBNB", symbol: "BNB",
    rpcs: ["https://opbnb-mainnet-rpc.bnbchain.org", "https://opbnb-rpc.publicnode.com"],
    explorer: "https://opbnbscan.com/tx/",
  },
  {
    id: "celo", name: "Celo", symbol: "CELO",
    rpcs: ["https://forno.celo.org", "https://celo-rpc.publicnode.com"],
    explorer: "https://celoscan.io/tx/",
  },
];

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpcCallOne(rpcUrl, method, params, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC request failed (${res.status})`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "RPC error");
    return json.result;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`Timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// Tries each RPC endpoint for a chain, preferring the first genuinely non-null result.
// Some free public RPCs return a successful response with result=null for transactions
// they simply don't have indexed, even when the tx is real — so we don't trust a single
// provider's "not found" answer until every fallback has also come back empty.
export async function rpcCall(chain, method, params) {
  let lastError = null;
  let sawSuccess = false;
  let nullResult = null;

  for (const url of chain.rpcs) {
    try {
      const result = await rpcCallOne(url, method, params);
      sawSuccess = true;
      if (result !== null && result !== undefined) {
        return result;
      }
      nullResult = result;
    } catch (e) {
      lastError = e;
    }
  }

  if (sawSuccess) return nullResult;
  throw new Error(`All RPC endpoints for ${chain.name} failed. Last error: ${lastError?.message || "unknown"}`);
}

export function hexToDecString(hex, decimals = 18, precision = 8) {
  if (!hex || hex === "0x" || hex === "0x0") return "0";
  const big = BigInt(hex);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = big / divisor;
  const frac = big % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function isValidTxHash(hash) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}
