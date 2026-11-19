# Trade Autopsy v2 — Spec (Trade Autopsy + Aftermath, one product)

Status: v2. D1, D2 and payments decision approved by Baqi 2026-11-19. M0 done and merged. Milestone order swapped 2026-11-19 (UI first, engine port second); UI direction approved by Baqi from the mockup. Nobody edits this file without Baqi's sign-off.
Owner/architect/reviewer: Claude. Implementers: ChatGPT, Antigravity (and Claude on request).

## 1. One-line product

Paste any EVM transaction hash. Get one **case file** that answers two questions:
1. **What happened?** (Trade Autopsy: classification, asset flows, fees, plain-language explanation)
2. **What did it leave behind?** (Aftermath: permissions granted, and whether they are still active today)

Primary user: someone who just signed something and wants to know what it did, and whether they are still exposed.

## 2. What exists today (verified from the code, 2026-11-19)

| | Trade Autopsy | Aftermath |
|---|---|---|
| Stack | JS, Next 14.2.35, no tests, no TS | TS, Next 16, viem, 109 passing tests |
| Scope | Many EVM chains (X Layer, Ethereum, BNB, Polygon, Arbitrum, Base, Optimism, ...) | Ethereum mainnet only |
| Strength | Deterministic classification: swap, bridge, NFT, Seaport, Permit2, approval, native trace, asset flows, action sequence | Decodes approval logs, checks CURRENT on-chain state, aggregates risk, honest UNKNOWN states |
| UI | One page (`app/page.jsx`), case-file look | Minimal component, placeholder home |
| Gaps | "Approval" is only a label; says nothing about whether it is still active | One chain, one input box, no explanation layer |

Both are fully server-side RPC readers. Neither needs a wallet connection.

## 3. Fix first (Milestone 0, before any feature)

M0 status on branch `m0-hygiene`: items 1, 2 and 3 done; item 4 partly done (Vitest, classification, cost-protection and API tests; recorded real-transaction golden fixtures still needed); item 5 done for Next (16.x, 0 audit findings), TypeScript migration deferred (incremental, from M1); item 6 belongs to M2 (engine port).

1. **Remove payments from v1 (decided).** Delete `lib/x402.js`, the `X-PAYMENT` handling, the 402 path and the hardcoded `X-PAYMENT-RESPONSE: verified` header from `app/api/analyze/route.js`. This also closes the current hole: with OKX keys missing, `verifyPayment` returns `valid: true, skipped: true`, so ANY request with an `X-PAYMENT` header skips the rate limit. Remove the x402 fields from the GET status response and env docs. Add a test that an `X-PAYMENT` header changes nothing.
2. **Cost protection (D2, recommended).** With no paid tier, the limit exists to stop strangers burning the RPC and OpenAI budget. `lib/rateLimit.js` is per-serverless-instance memory (the file says so itself), so it barely works on Vercel. Recommended: (a) cache finished case files by chain+hash (chain data is immutable once mined, so repeats cost nothing), (b) a small shared-store limit (Upstash free tier) on uncached analyses, (c) a hard daily cap on AI calls that falls back to the deterministic explanation.
3. **Docs lie.** `CLAUDE.md`/README describe an Anthropic-powered MVP with open P0s; the code uses OpenAI (`lib/openaiAnalysis.js`) and has already built classification, flows and swap/bridge/NFT detection. Rewrite them to match reality.
4. **No tests in Trade Autopsy.** Add Vitest + recorded RPC fixtures (offline). Golden tests for each classification type (section 7).
5. **Upgrade to a patched Next 16 and TypeScript.** Do it incrementally (allowJs), not a rewrite.
6. Port Aftermath's stale tests: two tests expect old raw error messages; the code intentionally returns safe `ANALYSIS_STAGE_FAILED:<stage>` errors (commit 3ec331e). Update the tests, not the code.

## 4. Product scope for v1

### Pages (desktop-first, responsive; real multi-column layouts, not a single narrow column)
- `/` Home: hash input with chain auto-detect, 6 curated real examples, "how it works" (3 steps), trust strip (what is deterministic vs AI).
- `/tx/[chain]/[hash]` **Case file** with a shareable permalink (the main deliverable). Sections:
  1. Header: verdict, transaction type, status, chain, block/time, explorer link
  2. Timeline: ordered action sequence
  3. Asset flows: table of what left / entered the main wallet(s), with unknowns shown as unknown
  4. **Permissions left behind** (from Aftermath): each approval granted, spender/operator, amount, SET or REVOKE, current state ACTIVE / INACTIVE / UNKNOWN, aggregate blast radius, plain reason
  5. Fees and gas
  6. Plain-language explanation (AI, clearly labelled interpretation, deterministic fallback if AI fails)
  7. Raw evidence (collapsed): logs, decoded transfers, provenance
- `/examples` One verified real transaction per type (swap, bridge, NFT sale, approval, failed tx, plain transfer). Builder must pick hashes and **verify each on chain**. Never invent a hash.
- `/method` What is read from chain, what AI does and does not do, known limits (Aftermath's "Interpretation and limits" text, rewritten for users).

### Chains
All chains Trade Autopsy supports get the classification. Residual-permission check runs wherever archive-free `eth_call` at latest block works; where it cannot be verified, show UNKNOWN with the reason. Never guess. Ethereum mainnet first, then Base, Arbitrum, Optimism, Polygon, BNB.

### Principles (inherited, non-negotiable)
Evidence, then reconstruction, then classification, then explanation. AI explains only; it never supplies facts. Unknown beats a confident guess.

## 5. Architecture decisions

- **Repo (decided, D1):** build in the existing `trade-autopsy` repo (keeps its live URL, Vercel project and history). Aftermath's engine moves in as `src/permissions/` (decode, residual, types and tests). Aftermath's repo is then archived with a README pointer to Trade Autopsy.
- One API route returns the whole case (`/api/analyze`); permissions computed in parallel with classification so the page is not slower than today. Case page can also stream sections.
- Keep modules pure and injectable (Aftermath's `AnalysisClient` pattern) so everything is testable offline.
- No new dependencies without a one-line justification in the PR.

## 6. Out of scope for v1 (do not build)
Wallet-level analysis, multi-transaction comparison, P&L, history/accounts, revoke buttons or wallet connection, payments of any kind (removed in M0), suspicious-activity scoring, API keys for third parties, Solana/non-EVM, `sableline`.

## 7. Done bar (v1 ships only when ALL are true)
1. `npm test`, `npm run typecheck`, `npm run build` all pass in CI (GitHub Actions) on a clean clone with no secrets.
2. Golden tests exist for: native transfer, ERC-20 transfer, swap, bridge, NFT purchase/sale, approval (set and revoke), failed tx, contract creation, unknown. Each asserts type AND asset movements against recorded RPC data.
3. Aftermath's tests ported and green; at least one residual-authority fixture per state (ACTIVE, INACTIVE, UNKNOWN).
4. Payment bypass closed, with a test proving a fake `X-PAYMENT` header does not skip the limit.
5. All four pages exist, work at 360px, 768px and 1440px widths, and have real empty, loading and error states.
6. Six verified example transactions load instantly (cached) and match their labels.
7. Case URLs are shareable and render without re-running the user's input.
8. README, CLAUDE.md, AGENTS.md and `/method` match the shipped behavior.
9. Baqi has used it on 10 real transactions of his own and at least one non-builder has used it and reported back.

## 8. Milestones (one at a time; each ends with Baqi reviewing a deployed preview)
- **M0** Hygiene: section 3.
- **M1** New UI shell on the existing engine: Home (one input accepting hash or explorer link), case page at `/tx/[chain]/[hash]` (shareable permalink, server-rendered from the cache or a fresh analysis), phone-first responsive layout, "Proved / Not proved / Unknown" evidence list, "What to do next", collapsed technical evidence, and a reserved "Permissions left behind" slot. No engine changes beyond what the permalink needs. Mockup is the visual reference.
- **M2** Engine merge: port Aftermath's permission engine into `src/permissions/` and fill the reserved slot (ACTIVE / INACTIVE / UNKNOWN per permission); port its tests and update the 2 stale ones (section 3, item 6); tests green; archive the `aftermath` repo afterwards.
- **M3** Examples (about 6 real, verified hashes; never invented), Method page, polish, accessibility, done-bar check, launch.

## 9. How the three AI builders work together
- Root `AGENTS.md` points every tool at this file. One spec, one source of truth.
- Work is ticketed. Each ticket names files, acceptance tests and a branch. One tool per ticket; no two tools edit the same files at once.
- Claude: writes tickets, owns architecture and review, merges only when section 7's relevant checks pass.
- ChatGPT / Antigravity: implement tickets on branches and open PRs. They do not change this spec, dependencies or architecture without a written note to Baqi.
- Every PR states: what changed, how it was tested, anything uncertain.

## 10. Decisions
- D1. DECIDED: build in `trade-autopsy`; archive `aftermath` after the engine is ported and its tests are green.
- D3. DECIDED: payments dropped from v1 (x402 removed).
- D2. DECIDED: cost protection as recommended in section 3.2 (cache, shared-store rate limit, daily AI cap). Needs Upstash env vars set in Vercel to be shared across instances.
