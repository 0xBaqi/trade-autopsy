const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["clean", "costly", "failed", "warning"],
    },
    summary: { type: "string" },
    why: { type: "string" },
    tip: { type: "string" },
  },
  required: ["verdict", "summary", "why", "tip"],
};

function extractResponseText(json) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  for (const item of Array.isArray(json?.output) ? json.output : []) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return null;
}

function buildEvidence(data) {
  return {
    chain: data.chain,
    hash: data.hash,
    status: data.success ? "SUCCESS" : "FAILED_OR_REVERTED",
    from: data.from,
    to: data.to,
    nativeValue: {
      amount: data.value,
      symbol: data.chain.symbol,
    },
    networkFee: {
      amount: data.feeEth,
      symbol: data.chain.symbol,
    },
    gas: {
      used: data.gasUsed,
      limit: data.gasLimit,
      usedPct: data.gasUsedPct,
    },
    blockNumber: data.blockNumber,
    classification: data.classification,
    tokenTransfers: data.tokenTransfers,
    assetFlows: data.assetFlows,
    evidenceLimits: {
      transactionClassificationIsDeterministic: true,
      tokenFlowsComeFromObservedErc20TransferEvents: true,
      internalNativeTransfersIncluded: false,
      networkFeeIncludedInAssetFlows: false,
      unsupportedProtocolActionsMustNotBeInferred: true,
    },
  };
}

export async function generateGroundedAnalysis(data) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const evidence = buildEvidence(data);
  const instructions = `You are the explanation layer for Trade Autopsy, an evidence-first blockchain transaction analyzer.

The deterministic engine has already reconstructed and classified the transaction. Your job is ONLY to explain that supplied evidence in plain language for a non-technical crypto user.

Rules:
- Treat the supplied classification, decoded token transfers, asset flows, status, fee, and gas values as the source of truth.
- Never invent a swap, bridge, protocol, purchase, sale, approval, scam, recipient identity, intent, profit/loss, or internal native transfer unless the supplied evidence explicitly proves it.
- Do not turn CONTRACT_INTERACTION into a more specific action. Say that the exact contract action is not proven when necessary.
- If classification is UNKNOWN or confidence is LOW, state that the available deterministic evidence does not support a more specific description.
- Asset flows cover top-level native value plus observed ERC-20 Transfer events only. They do not include internal native transfers, and network fees are separate.
- A zero ERC-20 event count does not prove that "nothing happened" inside a contract call.
- Do not call gas "expensive" or "cheap" without evidence that supports that comparison. The absolute network fee may be reported exactly.
- If the transaction failed or reverted, verdict must be "failed".
- For a successful transaction, use "warning" when the deterministic evidence is incomplete or low-confidence enough that a stronger conclusion would be misleading; otherwise use "clean". Use "costly" only when the supplied evidence itself clearly supports a cost warning.
- Keep summary to 1-2 short sentences, why to 1-2 short sentences, and tip to one short actionable sentence.
- Reference concrete observed amounts or classification evidence where useful.
- Return only the requested JSON object.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      store: false,
      max_output_tokens: 300,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "trade_autopsy_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
      instructions,
      input: `Explain this transaction using only this JSON evidence:\n${JSON.stringify(evidence)}`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI analysis failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }

  const json = await response.json();
  const text = extractResponseText(json);
  if (!text) throw new Error("OpenAI returned no analysis text.");

  const parsed = JSON.parse(text);
  if (!ANALYSIS_SCHEMA.properties.verdict.enum.includes(parsed.verdict)) {
    throw new Error("OpenAI returned an unsupported verdict.");
  }

  return {
    verdict: parsed.verdict,
    summary: parsed.summary,
    why: parsed.why,
    tip: parsed.tip,
  };
}
