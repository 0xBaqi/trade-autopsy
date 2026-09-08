import { NextResponse } from "next/server";
import { CHAINS, rpcCall, hexToDecString, isValidTxHash, TRANSFER_TOPIC } from "../../../lib/chains";
import { extractPayment, verifyPayment, paymentRequiredResponse, buildPaymentRequired } from "../../../lib/x402";
import { checkFreeTierLimit, getClientIp } from "../../../lib/rateLimit";
import { formatTokenAmount, resolveTokenMetadata } from "../../../lib/tokenMetadata";
import { classifyTransaction } from "../../../lib/transactionClassification";
import { reconstructAssetFlows } from "../../../lib/assetFlows";
import { detectSwapClassification } from "../../../lib/swapDetection";
import { generateGroundedAnalysis } from "../../../lib/openaiAnalysis";
import { buildDeterministicAnalysis } from "../../../lib/deterministicAnalysis";

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, x-payment",
    },
  });
}

// GET handler for health/discovery checks by onchainos and OKX review bot
export async function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "Trade Autopsy",
      description: "Plain-English post-mortem for any EVM transaction hash",
      payment: { protocol: "x402", version: 2, network: "eip155:196", price: "$0.01" },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-ACCEPTS-PAYMENT": "x402",
      },
    }
  );
}

export async function POST(req) {
  const resourceUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "https://trade-autopsy-addr.vercel.app"}/api/analyze`;
  const description = "Trade Autopsy: plain-English post-mortem for any EVM transaction hash";

  // Determine whether this is a paid x402 request or a free-tier request.
  const paymentHeader = extractPayment(req);

  if (paymentHeader) {
    // --- PAID PATH ---
    // Verify the x402 payment. Paid requests are not subject to the free-tier limit.
    const requirements = buildPaymentRequired(resourceUrl, description);
    const verification = await verifyPayment(paymentHeader, requirements);
    if (!verification.valid && !verification.skipped) {
      return NextResponse.json(
        { error: "Payment verification failed", details: verification.error },
        { status: 402 }
      );
    }
    // Payment verified — fall through to analysis.
  } else {
    // --- FREE TIER PATH ---
    // Apply per-IP rate limiting. This is best-effort: in-memory state is
    // not shared across serverless instances (see lib/rateLimit.js).
    const ip = getClientIp(req);
    const { allowed, retryAfter } = checkFreeTierLimit(ip);
    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: "Too many free analyses. Please wait before trying again.",
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    // Under the limit — fall through to analysis.
  }

  // --- ANALYSIS ---
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const hash = (body?.hash || "").trim();
  const chainId = body?.chainId;
  const chain = CHAINS.find((c) => c.id === chainId);

  if (!isValidTxHash(hash) || !chain) {
    return NextResponse.json({ error: "Missing or invalid hash/chain." }, { status: 400 });
  }

  let tx, receipt;
  try {
    [tx, receipt] = await Promise.all([
      rpcCall(chain, "eth_getTransactionByHash", [hash]),
      rpcCall(chain, "eth_getTransactionReceipt", [hash]),
    ]);
  } catch (e) {
    return NextResponse.json({ error: e.message || `Failed to reach ${chain.name}.` }, { status: 502 });
  }

  if (!tx || !receipt) {
    return NextResponse.json(
      { error: `Transaction not found on ${chain.name}, or its receipt isn't available yet (it may still be pending).` },
      { status: 404 }
    );
  }

  const success = receipt.status === "0x1";
  const gasUsed = BigInt(receipt.gasUsed || "0x0");
  const gasPrice = BigInt(tx.gasPrice || receipt.effectiveGasPrice || "0x0");
  const feeWei = gasUsed * gasPrice;
  const feeEth = hexToDecString("0x" + feeWei.toString(16), 18);
  const gasLimit = BigInt(tx.gas || "0x0");
  const gasUsedPct = gasLimit > 0n ? Number((gasUsed * 10000n) / gasLimit) / 100 : null;
  const value = hexToDecString(tx.value, 18);

  // ERC-20 and ERC-721 share the Transfer(address,address,uint256) signature.
  // A standard ERC-20 Transfer has exactly 3 topics and a single 32-byte
  // uint256 in data. Restrict decoding to that shape so NFT token IDs are not
  // accidentally reported as fungible-token amounts.
  const topicPattern = /^0x[0-9a-fA-F]{64}$/;
  const uint256DataPattern = /^0x[0-9a-fA-F]{64}$/;
  const decodedTransfers = (receipt.logs || [])
    .filter(
      (log) =>
        log.address &&
        Array.isArray(log.topics) &&
        log.topics.length === 3 &&
        log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
        topicPattern.test(log.topics[1] || "") &&
        topicPattern.test(log.topics[2] || "") &&
        uint256DataPattern.test(log.data || "")
    )
    .map((log) => ({
      tokenAddress: log.address,
      from: `0x${log.topics[1].slice(-40)}`,
      to: `0x${log.topics[2].slice(-40)}`,
      rawAmount: BigInt(log.data).toString(),
    }));

  // Resolve metadata once per unique token contract. Metadata is optional:
  // non-standard/reverting contracts keep their raw evidence rather than
  // receiving guessed symbol/decimal values. Use the receipt block so the
  // metadata reflects the contract state at the time of the transaction.
  const uniqueTokenAddresses = [...new Set(decodedTransfers.map((transfer) => transfer.tokenAddress.toLowerCase()))];
  const metadataEntries = await Promise.all(
    uniqueTokenAddresses.map(async (tokenAddress) => [
      tokenAddress,
      await resolveTokenMetadata(chain, tokenAddress, receipt.blockNumber),
    ])
  );
  const metadataByAddress = new Map(metadataEntries);

  const tokenTransfers = decodedTransfers.map((transfer) => {
    const metadata = metadataByAddress.get(transfer.tokenAddress.toLowerCase()) || { symbol: null, decimals: null };
    return {
      ...transfer,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      amount: formatTokenAmount(transfer.rawAmount, metadata.decimals),
    };
  });

  const baseClassification = classifyTransaction({ tx, receipt, tokenTransfers });
  const assetFlows = reconstructAssetFlows({ tx, receipt, chain, tokenTransfers });
  const swapClassification =
    baseClassification.type === "CONTRACT_INTERACTION"
      ? detectSwapClassification({ tx, receipt, assetFlows })
      : null;
  const classification = swapClassification || baseClassification;

  const data = {
    hash,
    chain: { id: chain.id, name: chain.name, symbol: chain.symbol, explorer: chain.explorer },
    success,
    from: tx.from,
    to: tx.to,
    value,
    feeEth,
    gasUsed: gasUsed.toString(),
    gasLimit: gasLimit.toString(),
    gasUsedPct,
    blockNumber: parseInt(receipt.blockNumber, 16),
    logCount: (receipt.logs || []).length,
    transferCount: tokenTransfers.length,
    tokenTransfers,
    classification,
    assetFlows,
  };

  // The deterministic explanation is the baseline product. OpenAI is an
  // optional polish layer: missing credit, missing credentials, or provider
  // failure must never make the transaction report unusable.
  let analysis = buildDeterministicAnalysis(data);

  try {
    const groundedAnalysis = await generateGroundedAnalysis(data);
    if (groundedAnalysis) analysis = groundedAnalysis;
  } catch (e) {
    console.error("[analysis] OpenAI explanation failed:", e?.message || e);
    // Keep the deterministic explanation above.
  }

  return NextResponse.json(
    { caseData: data, analysis },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "X-PAYMENT-RESPONSE": "verified",
      },
    }
  );
}
