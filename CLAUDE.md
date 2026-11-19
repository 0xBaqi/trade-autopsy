@AGENTS.md

# Trade Autopsy: project instructions

Plan, scope and "done" bar live in [SPEC.md](SPEC.md). Read it before changing anything.

## Product

Paste an EVM transaction hash, get a case file that says what happened and why. Core principle: **Evidence, then reconstruction, then classification, then explanation.** Never "transaction, then AI guess".

Preferred positioning: "What actually happened on-chain?"

## Rules for the AI explanation layer

The model (`lib/openaiAnalysis.js`) explains structured evidence only. It must not invent token amounts, addresses, transaction types, protocol interactions, scams or intent, must not call every success a trade, and must say when evidence is incomplete. Deterministic code (`lib/`) decides every blockchain fact. When uncertain: `UNKNOWN`, never a confident guess.

## Architecture (verify against the code before relying on this)

- `app/page.jsx`: current single-page UI (case-file look). To be replaced per SPEC.md.
- `app/api/detect/route.js`: finds which supported chain holds a hash (fans out to every chain).
- `app/api/analyze/route.js`: fetches evidence, runs the deterministic pipeline, optional AI explanation, caches the result.
- `app/api/health/route.js`: status.
- `lib/chains.js`: 20 supported chains, RPC fallbacks, helpers.
- `lib/guard.js`: result cache, per-IP rate limit, daily AI budget (Upstash REST, in-memory fallback).
- `lib/transactionClassification.js`, `assetFlows.js`, `swapDetection.js`, `bridgeDetection.js`, `seaportMarketplaceDetection.js`, `nftActionDetection.js`, `walletReconstruction.js`, `actionSequence.js`, `activityEvidence.js`, `nativeTrace.js`, `tokenMetadata.js`: the deterministic engine.
- `lib/deterministicAnalysis.js`: fallback explanation when AI is unavailable.
- `tests/`: offline Vitest suite. Run `npm test`.

## Working rules

1. Inspect the existing code first; make the smallest change that does the job.
2. Do not rewrite working modules, add dependencies without justification, or touch unrelated files.
3. No payments, wallets or accounts in v1.
4. Secrets stay server-side. Never commit `.env*`. A value sent from the browser is not secret.
5. Test fixtures must be real recorded RPC responses or clearly labelled synthetic data. Never invent transaction hashes.
6. Run `npm test && npm run build` before every PR. Report exactly what changed and how it was tested.
