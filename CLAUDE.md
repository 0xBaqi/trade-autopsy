# Trade Autopsy — Project Instructions

## 1. What is Trade Autopsy?

Trade Autopsy is an AI-powered on-chain transaction investigation and explanation tool.

Core promise:

> Understand what actually happened on-chain.

A user provides an EVM transaction hash. Trade Autopsy should:

1. Detect the relevant blockchain.
2. Fetch reliable blockchain evidence.
3. Reconstruct what happened.
4. Classify the transaction.
5. Build a structured case.
6. Use AI to explain the evidence in plain language.

The goal is to make complex blockchain activity understandable without sacrificing factual accuracy.

---

## 2. Core Product Principle

Evidence → Reconstruction → Classification → Explanation

NOT:

Transaction → AI guess

Blockchain facts must come from deterministic sources such as:

- RPC responses
- Transaction data
- Transaction receipts
- Event logs
- Decoded events
- Contract/token metadata where available

Claude is an explanation layer.

Claude must NOT invent blockchain facts.

If the available evidence is insufficient, the system should explicitly say that the information is unknown or uncertain.

Accuracy is more important than confidence.

---

## 3. Current MVP

The current application:

- Accepts an EVM transaction hash.
- Detects supported chains.
- Fetches transaction and receipt information.
- Calculates gas/network fee information.
- Inspects event logs.
- Sends transaction evidence to Claude.
- Generates a human-readable transaction report.
- Displays the result using a forensic/case-file style UI.

The current UI includes:

- Transaction search
- Chain detection
- Case number
- Summary
- Why
- Tip for next time
- Transaction status
- Network fee
- From
- To
- Gas information
- Token transfers
- Raw evidence
- Explorer link

---

## 4. Current Architecture

This is a Next.js application.

Important files/directories currently include:

- app/page.jsx
  - Main frontend and transaction analysis flow.

- app/api/detect/route.js
  - Detects which supported chain contains a transaction.

- app/api/analyze/route.js
  - Fetches transaction evidence.
  - Builds the AI analysis request.
  - Calls Claude.
  - Returns the analysis.

- lib/chains.js
  - Supported blockchain configuration.
  - RPC endpoints and fallback logic.

- lib/x402.js
  - x402/payment-related functionality.

- .env.local.example
  - Documents required environment variables without exposing secrets.

Always inspect the current code before assuming this architecture is unchanged.

---

## 5. AI Rules

Claude should explain structured evidence, not discover facts that can be determined from blockchain data.

Claude must NOT:

- Invent token amounts.
- Invent addresses.
- Invent transaction types.
- Invent protocol interactions.
- Claim assets moved without evidence.
- Call every successful transaction a trade.
- Make unsupported fraud/security claims.

Claude SHOULD:

- Explain observed blockchain evidence.
- Translate technical concepts into plain language.
- Explain why a transaction behaved as it did.
- Clearly distinguish facts from interpretation.
- State uncertainty when evidence is incomplete.

---

## 6. Transaction Classification

A transaction is NOT automatically a trade.

The system should eventually classify transactions into types such as:

- Native token transfer
- ERC-20 token transfer
- Token swap
- Contract interaction
- Token approval
- Failed transaction
- Bridge transaction
- NFT transaction
- Other/unknown

Classification should be deterministic wherever reasonably possible.

Do not use generic labels such as CLEAN TRADE for every successful transaction.

---

## 7. Blockchain Evidence

Relevant evidence may include:

- Transaction hash
- Chain
- Block number
- Timestamp
- Status
- Sender
- Recipient
- Native value
- Gas limit
- Gas used
- Gas price
- Network fee
- Transaction input/data
- Event logs
- Decoded token transfers
- Contract addresses
- Token addresses
- Token symbols
- Token decimals
- Token amounts
- Asset inflows
- Asset outflows

Do not ask the LLM to calculate or guess facts that can be obtained directly from the blockchain.

---

## 8. Token Transfer Decoding

The current implementation can detect/count Transfer events but needs stronger structured decoding.

Target representation:

tokenAddress
tokenSymbol
decimals
from
to
amount

If metadata cannot be reliably obtained, use an explicit unknown value instead of guessing.

---

## 9. Security

Never expose secrets in client-side code.

Never commit:

- API keys
- Private keys
- RPC secrets
- Anthropic API keys
- Payment credentials
- Authentication secrets

A value sent from the browser is NOT secret.

Do not use a client-exposed internal key as a privileged authentication mechanism.

Before monetization or public API access, verify that authentication and payment protections cannot be bypassed from the client.

---

## 10. Current Known Issues

P0 — Security

Review and remove the client-exposed internal API bypass mechanism.

P0 — Evidence accuracy

Properly decode ERC-20 Transfer events into structured records instead of only counting them.

P0 — Classification

Create a deterministic transaction classification layer.

P1 — AI grounding

Pass structured blockchain evidence to Claude and ensure explanations remain grounded in that evidence.

P1 — Result terminology

Replace generic trade terminology with the actual transaction type.

P1 — Asset changes

Represent assets entering and leaving the relevant wallet.

P2 — Transaction flow

Eventually visualize flows such as:

Wallet → Protocol → Wallet

or:

Wallet → Recipient

P2 — Shareable cases

Eventually support shareable public autopsy reports.

---

## 11. Current Priority Order

Do not skip ahead while higher-priority issues remain unresolved.

Sprint 1:

1. Fix security issues.
2. Decode ERC-20 Transfer events.
3. Build deterministic transaction classification.
4. Ground Claude's explanation in structured evidence.
5. Correct transaction-type terminology.

Sprint 2:

6. Add asset inflow/outflow representation.
7. Improve failed transaction explanations.
8. Add transaction flow visualization.
9. Add protocol identification where reliable.
10. Add example transactions.

Later:

- Shareable autopsy reports
- Wallet-level analysis
- Multiple transaction analysis
- Trade P&L
- Suspicious transaction signals
- Historical patterns
- API access
- Paid features

Do not build future features prematurely.

---

## 12. Product Design

Preserve the current forensic/case-file visual identity unless there is a strong reason to change it.

The product should feel:

- Investigative
- Clear
- Evidence-driven
- Trustworthy
- Technical but understandable
- Fast

Avoid unnecessary dashboards and features that do not directly improve transaction understanding.

Preferred positioning:

What actually happened on-chain?

Supporting message:

Paste a transaction hash. Trade Autopsy reconstructs what happened and explains it in plain language.

---

## 13. Development Rules

Before modifying code:

1. Inspect the existing implementation.
2. Identify the affected files.
3. Explain the proposed change.
4. Identify risks or possible regressions.
5. Implement the smallest appropriate change.
6. Test the change.
7. Report exactly what changed.

Do NOT:

- Rewrite working components unnecessarily.
- Introduce dependencies without justification.
- Modify unrelated files.
- Change the product direction without approval.
- Add features simply because they sound interesting.
- Replace deterministic blockchain logic with LLM guesses.

Prefer small, testable changes.

---

## 14. Testing

Important test cases include:

1. Simple native token transfer.
2. ERC-20 token transfer.
3. Successful token swap.
4. Failed transaction.
5. Token approval.
6. Contract interaction.
7. Multiple token transfers.
8. Transaction found on one supported chain.
9. Invalid transaction hash.
10. Transaction not found.

For every test, verify that the reported transaction type and asset movements are supported by actual blockchain evidence.

---

## 15. Working Principle

When uncertain:

DO NOT GUESS.

Prefer:

Transaction type: Unknown

over incorrectly claiming:

Token Swap

The product's most important asset is trust.

Every new feature should make Trade Autopsy more accurate, more useful, or easier to understand.
