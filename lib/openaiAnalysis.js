const ANALYSIS_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { verdict: { type: "string", enum: ["clean", "costly", "failed", "warning"] }, summary: { type: "string" }, why: { type: "string" }, tip: { type: "string" } },
  required: ["verdict", "summary", "why", "tip"],
};
function extractResponseText(json) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  for (const item of Array.isArray(json?.output) ? json.output : []) { if (item?.type !== "message") continue; for (const part of Array.isArray(item.content) ? item.content : []) if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) return part.text.trim(); }
  return null;
}
function buildEvidence(data) {
  return {
    chain: data.chain, hash: data.hash, status: data.success ? "SUCCESS" : "FAILED_OR_REVERTED", from: data.from, to: data.to,
    nativeValue: { amount: data.value, symbol: data.chain.symbol }, networkFee: { amount: data.feeEth, symbol: data.chain.symbol },
    gas: { used: data.gasUsed, limit: data.gasLimit, usedPct: data.gasUsedPct }, blockNumber: data.blockNumber,
    classification: data.classification, tokenTransfers: data.tokenTransfers, nftTransfers: data.nftTransfers,
    assetFlows: data.assetFlows, walletActivity: data.walletActivity,
    evidenceLimits: {
      transactionClassificationIsDeterministic: true,
      walletActivityIsSenderCentric: true,
      nftTransferEventsProveMovementNotEconomicMeaning: true,
      backgroundNftMovementsAreNotSenderWalletMovements: true,
      networkFeeIncludedInAssetFlows: false,
      unsupportedProtocolActionsMustNotBeInferred: true,
    },
  };
}
export async function generateGroundedAnalysis(data) {
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) return null;
  const evidence = buildEvidence(data);
  const instructions = `You are the explanation layer for Trade Autopsy, an evidence-first blockchain transaction analyzer.
The deterministic engine has already reconstructed the transaction from the sender wallet's perspective. Explain ONLY the supplied evidence in plain language.
Rules:
- Treat classification and walletActivity as source of truth.
- Lead the summary with what entered and left the sender wallet. Do not lead with unrelated background events.
- Native assets, ERC-20 tokens, ERC-721 NFTs and ERC-1155 items are all wallet asset movements. Do not describe native ETH as a fungible-token event count.
- NFT transfer evidence proves movement only. Never call it a purchase, sale, mint, burn, gift, marketplace trade, or payment relationship unless supplied deterministic evidence explicitly proves that meaning.
- backgroundNftMovements happened elsewhere in the transaction and must not be described as entering or leaving the sender wallet.
- Never invent a swap, bridge, protocol, approval, scam, recipient identity, intent, profit/loss, or internal native transfer.
- Do not turn CONTRACT_INTERACTION into a more specific action.
- Network fees are separate from wallet asset flows.
- If failed, verdict must be failed. For an unresolved successful CONTRACT_INTERACTION use warning.
- Keep summary to 1-2 short sentences, why to 1-2 short sentences, and tip to one short actionable sentence.
- Return only the requested JSON object.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-5.6-luna", reasoning: { effort: "none" }, store: false, max_output_tokens: 300, text: { verbosity: "low", format: { type: "json_schema", name: "trade_autopsy_analysis", strict: true, schema: ANALYSIS_SCHEMA } }, instructions, input: `Explain this transaction using only this JSON evidence:\n${JSON.stringify(evidence)}` }),
  });
  if (!response.ok) { const body = await response.text().catch(() => ""); throw new Error(`OpenAI analysis failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`); }
  const json = await response.json(); const text = extractResponseText(json); if (!text) throw new Error("OpenAI returned no analysis text.");
  const parsed = JSON.parse(text); if (!ANALYSIS_SCHEMA.properties.verdict.enum.includes(parsed.verdict)) throw new Error("OpenAI returned an unsupported verdict.");
  return { verdict: parsed.verdict, summary: parsed.summary, why: parsed.why, tip: parsed.tip };
}
