import { NextResponse } from "next/server";
import { CHAINS, rpcCall, hexToDecString, isValidTxHash, TRANSFER_TOPIC } from "../../../lib/chains";
import { extractPayment, verifyPayment, paymentRequiredResponse, buildPaymentRequired } from "../../../lib/x402";
import { checkFreeTierLimit, getClientIp } from "../../../lib/rateLimit";

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
  const tokenTransfers = (receipt.logs || [])
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
  };

  const facts = `
Chain: ${data.chain.name}
Transaction hash: ${data.hash}
Status: ${data.success ? "SUCCESS" : "REVERTED/FAILED"}
From: ${data.from}
To: ${data.to || "(contract creation)"}
Native value sent: ${data.value} ${data.chain.symbol}
Gas used: ${data.gasUsed} of ${data.gasLimit} limit (${data.gasUsedPct}%)
Network fee paid: ${data.feeEth} ${data.chain.symbol}
Number of event logs emitted: ${data.logCount}
Number of token Transfer events: ${data.transferCount}
Block number: ${data.blockNumber}
  `.trim();

  const prompt = `You are a blockchain forensic analyst writing a short case report for a non-technical crypto user about a single on-chain transaction. Here are the raw facts pulled from the chain:

${facts}

Write a plain-language report with exactly these sections, each on its own line prefixed by the label shown:
VERDICT: one of [clean, costly, failed, warning] — pick "failed" if status is reverted, "costly" if it succeeded but gas usage/fees look unusually high relative to a simple transfer, "warning" if something looks off (e.g. very high gas usage % suggesting a near-failure, zero transfers on a contract call, or unusual patterns), otherwise "clean".
SUMMARY: 1-2 plain sentences describing what this transaction most likely did, in everyday language, no jargon.
WHY: 1-2 sentences explaining the specific reason for the outcome (why it failed, why it cost what it cost, or why it's routine) — reference the actual numbers.
TIP: one short, concrete, actionable sentence of advice for next time, relevant to what happened here.

Do not use markdown formatting, headers, or bullet points. Keep each section to the sentence counts specified.`;

  let analysis = {
    verdict: "warning",
    summary: "The transaction data was retrieved, but the analysis couldn't be generated.",
    why: "The analysis service didn't respond as expected.",
    tip: "You can still review the raw evidence below.",
  };

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = await anthropicRes.json();
    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const parsed = { verdict: "warning", summary: "", why: "", tip: "" };
    let matchedAny = false;
    text.split("\n").forEach((line) => {
      const m = line.match(/^(VERDICT|SUMMARY|WHY|TIP):\s*(.*)$/i);
      if (m) {
        matchedAny = true;
        parsed[m[1].toLowerCase()] = m[2].trim();
      }
    });
    if (matchedAny) {
      if (!["clean", "costly", "failed", "warning"].includes(parsed.verdict)) parsed.verdict = "warning";
      analysis = parsed;
    }
  } catch (e) {
    // Keep the fallback analysis above; the raw evidence is still returned.
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
