# Trade Autopsy

**Understand what happened in an on-chain transaction—and why.**

Trade Autopsy is a plain-language blockchain transaction explainer. Paste a transaction hash from a supported chain to get a case-file-style breakdown of the transaction's outcome, activity, and costs.

**[Open the deployed app](https://trade-autopsy-addr.vercel.app/)** · [Source code](https://github.com/0xBaqi/trade-autopsy)

> **Availability note:** The deployment URL is recorded in the builder's GitHub profile; current uptime has not been independently verified. The application requires a configured Anthropic API key for AI analysis.

## What it does

- Accepts a transaction hash on a supported EVM network.
- Retrieves transaction information through public RPC endpoints.
- Uses Claude to help explain the observed activity in accessible language.
- Presents the analysis as a readable transaction case file.

## Supported chains

X Layer, Ethereum, Base, Arbitrum, Optimism, Polygon, and BNB Chain.

Public RPC endpoints do not require user-supplied RPC API keys. AI analysis requires a server-side Anthropic API key.

## Run locally

Requires Node.js and an Anthropic API key.

```bash
npm install
cp .env.local.example .env.local
# Set ANTHROPIC_API_KEY in .env.local
npm run dev
```

Open http://localhost:3000.

The API key is used server-side in `app/api/analyze/route.js`. Never commit `.env.local` or expose the key in client-side code.

## Deploy on Vercel

1. Import this repository into Vercel.
2. Configure `ANTHROPIC_API_KEY` in the project's environment variables.
3. Deploy and verify the public URL.
4. Test a successful and a failed/reverted transaction where supported.

## Project background

Originally built for an OKX.AI hackathon submission. The project is intended to make blockchain transaction outcomes easier to inspect without requiring users to manually interpret raw RPC responses.

## Limitations

AI explanations should be checked against the underlying transaction evidence. RPC availability and provider limits may affect analysis, and a deployed frontend does not guarantee that the AI backend is currently configured or available.
