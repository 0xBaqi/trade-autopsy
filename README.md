# Trade Autopsy

**Understand what happened in an on-chain transaction, and why.**

Paste an EVM transaction hash. Trade Autopsy finds the chain, reads the transaction and receipt from public RPCs, reconstructs what happened with deterministic rules, and explains it in plain language as a case file.

**[Open the app](https://trade-autopsy-addr.vercel.app/)** · [Source](https://github.com/0xBaqi/trade-autopsy)

> Status: working MVP, being rebuilt into a fuller product. See [SPEC.md](SPEC.md) for the plan and the "done" bar. Current uptime is not independently monitored.

## How it works

Evidence, then reconstruction, then classification, then explanation.

1. **Evidence** comes only from chain data: transaction, receipt, logs, token metadata, and native-transfer traces where a provider exposes them.
2. **Reconstruction and classification are deterministic code** (`lib/`): native/ERC-20/NFT transfers, token approvals, swaps, Across bridge deposits, Seaport marketplace trades, Permit2, asset flows per wallet, and an ordered action sequence. When the evidence does not support a label, the answer is `UNKNOWN` or `CONTRACT_INTERACTION`, never a guess.
3. **AI only explains.** An OpenAI model receives the structured evidence and writes a short summary. If AI is unavailable, over budget, or fails, a deterministic explanation is shown instead.

## Supported chains (20)

Ethereum, X Layer, BNB Chain, Polygon, Arbitrum, Base, Optimism, zkSync Era, Linea, Scroll, Blast, Mantle, Mode, Manta Pacific, Zora, Unichain, Avalanche, Gnosis Chain, opBNB, Celo. Defined in `lib/chains.js`.

## Run locally

Requires Node.js 20+.

```bash
npm install
cp .env.local.example .env.local   # see the variables below
npm run dev                        # http://localhost:3000
npm test                           # offline unit and API tests
npm run build
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables the AI explanation. Without it, the deterministic explanation is used. |
| `AI_DAILY_CAP` | No | Max AI explanations per UTC day (default 300). Past it, the deterministic explanation is served. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Recommended in production | Shared store for the result cache, per-IP rate limits and the AI budget. Without them an in-memory fallback is used, which is per serverless instance and therefore best-effort only. |
| `ETHERSCAN_API_KEY` | No | Improves internal native-transfer evidence where public RPCs do not expose traces. |
| `ETHEREUM_RPC_URL`, `ETHEREUM_RPC_URL_2` | No | Extra Ethereum RPC endpoints. |

Secrets are read server-side only. Never commit `.env.local`.

## Cost protection

- Finished case files are cached by chain and hash for 6 hours (10 minutes if the AI explanation fell back), so repeats cost nothing.
- Uncached analyses are limited to 15 per IP per 10 minutes; chain detection to 30 per IP per 10 minutes.
- AI explanations stop at the daily cap.

There is no payment layer and no API key system.

## API

- `POST /api/detect` with `{ "hash": "0x..." }` returns the chains where the hash exists.
- `POST /api/analyze` with `{ "hash": "0x...", "chainId": "ethereum" }` returns `{ caseData, analysis }`.
- `GET /api/health` returns service status.

## Limitations

- Explanations are interpretation. Check them against the evidence shown in the case file.
- Public RPCs can be slow or rate limited, and some chains do not expose traces, so internal native transfers may be unavailable.
- Wallet activity is sender-centric. Only supported protocol actions are recognised; everything else is reported as a contract interaction.
- No tests yet against recorded real transactions on every chain; the current suite covers the classification rules, the cost-protection layer and the API routes with synthetic and mocked data.

## Project background

Started as an OKX.AI hackathon submission. An earlier version offered pay-per-analysis through x402; that was removed.
