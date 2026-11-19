# Instructions for AI coding tools (Claude, ChatGPT, Antigravity)

1. Read [SPEC.md](SPEC.md) first. It is the single source of truth for scope, architecture and the "done" bar. Do not change it without Baqi's approval.
2. Work only on the ticket you were given, on its own branch. Do not touch unrelated files.
3. Before opening a PR run: `npm test && npm run build`. State in the PR what changed, how you tested it, and anything you are unsure about.
4. Product rules (non-negotiable):
   - Blockchain facts come from deterministic code and RPC data. AI only explains supplied evidence and must never invent addresses, amounts, protocols or intent.
   - When evidence is insufficient, output `UNKNOWN` (or the honest generic label). Never guess.
   - Never put secrets in client code, never commit `.env*` files, never invent transaction hashes or fixtures. Recorded fixtures must come from real RPC responses.
   - No new dependencies without a one-line justification.
5. Do not add payments, wallet connections or accounts. They are out of scope for v1.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
