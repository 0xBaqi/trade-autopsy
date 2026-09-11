import { NextResponse } from "next/server";
import { CHAINS, rpcTransactionBundle, hexToDecString, isValidTxHash, TRANSFER_TOPIC } from "../../../lib/chains";
import { extractPayment, verifyPayment, paymentRequiredResponse, buildPaymentRequired } from "../../../lib/x402";
import { checkFreeTierLimit, getClientIp } from "../../../lib/rateLimit";
import { formatTokenAmount, resolveTokenMetadata } from "../../../lib/tokenMetadata";
import { classifyTransaction } from "../../../lib/transactionClassification";
import { reconstructAssetFlows } from "../../../lib/assetFlows";
import { detectSwapClassification } from "../../../lib/swapDetection";
import { detectAcrossBridgeDeposit } from "../../../lib/bridgeDetection";
import { detectNftLifecycleAction } from "../../../lib/nftActionDetection";
import { buildActivityEvidence } from "../../../lib/activityEvidence";
import { reconstructActionSequence } from "../../../lib/actionSequence";
import { reconstructWalletActivity } from "../../../lib/walletReconstruction";
import { traceNativeTransfers } from "../../../lib/nativeTrace";
import { decodeNftTransfers } from "../../../lib/nftEvidence";
import { generateGroundedAnalysis } from "../../../lib/openaiAnalysis";
import { buildDeterministicAnalysis } from "../../../lib/deterministicAnalysis";

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, x-payment" } });
}
export async function GET() {
  return new Response(JSON.stringify({ status: "ok", service: "Trade Autopsy", description: "Plain-English post-mortem for any EVM transaction hash", payment: { protocol: "x402", version: 2, network: "eip155:196", price: "$0.01" } }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-ACCEPTS-PAYMENT": "x402" } });
}
export async function POST(req) {
  const resourceUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "https://trade-autopsy-addr.vercel.app"}/api/analyze`;
  const description = "Trade Autopsy: plain-English post-mortem for any EVM transaction hash";
  const paymentHeader = extractPayment(req);
  if (paymentHeader) {
    const requirements = buildPaymentRequired(resourceUrl, description);
    const verification = await verifyPayment(paymentHeader, requirements);
    if (!verification.valid && !verification.skipped) return NextResponse.json({ error: "Payment verification failed", details: verification.error }, { status: 402 });
  } else {
    const ip = getClientIp(req);
    const { allowed, retryAfter } = checkFreeTierLimit(ip);
    if (!allowed) return new Response(JSON.stringify({ error: "Too many free analyses. Please wait before trying again.", retryAfter }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const hash = (body?.hash || "").trim();
  const chainId = body?.chainId;
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!isValidTxHash(hash) || !chain) return NextResponse.json({ error: "Missing or invalid hash/chain." }, { status: 400 });
  let tx, receipt;
  try { ({ tx, receipt } = await rpcTransactionBundle(chain, hash)); }
  catch (e) { return NextResponse.json({ error: e.message || `Failed to reach ${chain.name}.` }, { status: 502 }); }
  if (!tx || !receipt) return NextResponse.json({ error: `Transaction not found on ${chain.name}, or its receipt isn't available yet (it may still be pending).` }, { status: 404 });

  const success = receipt.status === "0x1";
  const gasUsed = BigInt(receipt.gasUsed || "0x0");
  const gasPrice = BigInt(receipt.effectiveGasPrice || tx.gasPrice || "0x0");
  const feeWei = gasUsed * gasPrice;
  const feeEth = hexToDecString("0x" + feeWei.toString(16), 18);
  const gasLimit = BigInt(tx.gas || "0x0");
  const gasUsedPct = gasLimit > 0n ? Number((gasUsed * 10000n) / gasLimit) / 100 : null;
  const value = hexToDecString(tx.value, 18);
  const topicPattern = /^0x[0-9a-fA-F]{64}$/;
  const uint256DataPattern = /^0x[0-9a-fA-F]{64}$/;
  const decodedTransfers = (receipt.logs || []).filter((log) => log.address && Array.isArray(log.topics) && log.topics.length === 3 && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() && topicPattern.test(log.topics[1] || "") && topicPattern.test(log.topics[2] || "") && uint256DataPattern.test(log.data || "")).map((log) => {
    const parsedLogIndex = typeof log.logIndex === "string" && /^0x[0-9a-fA-F]+$/.test(log.logIndex) ? Number.parseInt(log.logIndex, 16) : Number.isInteger(log.logIndex) ? log.logIndex : null;
    return { tokenAddress: log.address, from: `0x${log.topics[1].slice(-40)}`, to: `0x${log.topics[2].slice(-40)}`, rawAmount: BigInt(log.data).toString(), logIndex: Number.isSafeInteger(parsedLogIndex) ? parsedLogIndex : null };
  });
  const uniqueTokenAddresses = [...new Set(decodedTransfers.map((transfer) => transfer.tokenAddress.toLowerCase()))];
  const metadataEntries = await Promise.all(uniqueTokenAddresses.map(async (tokenAddress) => [tokenAddress, await resolveTokenMetadata(chain, tokenAddress, receipt.blockNumber)]));
  const metadataByAddress = new Map(metadataEntries);
  const tokenTransfers = decodedTransfers.map((transfer) => {
    const metadata = metadataByAddress.get(transfer.tokenAddress.toLowerCase()) || { symbol: null, decimals: null };
    return { ...transfer, symbol: metadata.symbol, decimals: metadata.decimals, amount: formatTokenAmount(transfer.rawAmount, metadata.decimals) };
  });
  const nftTransfers = success ? decodeNftTransfers(receipt) : [];

  const nativeTrace = success ? await traceNativeTransfers(chain, hash, tx, receipt) : { available: false, source: null, transfers: [], diagnostics: null };
  const baseClassification = classifyTransaction({ tx, receipt, tokenTransfers, nftTransfers });
  const assetFlows = reconstructAssetFlows({ tx, receipt, chain, tokenTransfers, nativeTrace });
  const walletActivity = reconstructWalletActivity({ tx, assetFlows, nftTransfers });

  const canDetectHigherLevelActions = baseClassification.type === "CONTRACT_INTERACTION";
  const bridgeDetection = canDetectHigherLevelActions ? detectAcrossBridgeDeposit({ tx, receipt, assetFlows, chainId: chain.id }) : null;
  const swapDetection = canDetectHigherLevelActions ? detectSwapClassification({ tx, receipt, assetFlows, chainId: chain.id, tokenTransfers }) : null;
  const nftLifecycleDetection = canDetectHigherLevelActions ? detectNftLifecycleAction({ tx, nftTransfers }) : null;
  const classification = bridgeDetection || swapDetection || nftLifecycleDetection || baseClassification;
  const detections = { bridge: bridgeDetection, swap: swapDetection, nftLifecycle: nftLifecycleDetection };
  const activities = buildActivityEvidence({ classification, detections, tokenTransfers, nftTransfers });
  const actionSequence = reconstructActionSequence({ classification, activities });
  const data = { hash, chain: { id: chain.id, name: chain.name, symbol: chain.symbol, explorer: chain.explorer }, success, from: tx.from, to: tx.to, value, feeEth, gasUsed: gasUsed.toString(), gasLimit: gasLimit.toString(), gasUsedPct, blockNumber: parseInt(receipt.blockNumber, 16), logCount: (receipt.logs || []).length, transferCount: tokenTransfers.length, tokenTransfers, nftTransferCount: nftTransfers.length, nftTransfers, classification, assetFlows, walletActivity, nativeTrace: { available: nativeTrace.available, source: nativeTrace.source, transferCount: nativeTrace.transfers.length, diagnostics: nativeTrace.diagnostics || null }, activities, actionSequence };
  let analysis = buildDeterministicAnalysis(data);
  try { const groundedAnalysis = await generateGroundedAnalysis(data); if (groundedAnalysis) analysis = groundedAnalysis; }
  catch (e) { console.error("[analysis] OpenAI explanation failed:", e?.message || e); }
  return NextResponse.json({ caseData: data, analysis }, { headers: { "Access-Control-Allow-Origin": "*", "X-PAYMENT-RESPONSE": "verified" } });
}
