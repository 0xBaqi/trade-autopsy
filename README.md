# Trade Autopsy

A plain-language on-chain transaction explainer. Paste a tx hash from any supported
chain, get a case-file style report on what happened, why, and what it cost.

## Deploy in ~10 minutes (Vercel)

1. Push this folder to a new GitHub repo.
2. Go to https://vercel.com/new and import that repo.
3. Vercel auto-detects Next.js — no config needed.
4. Before deploying, add an environment variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from https://console.anthropic.com/settings/keys
5. Deploy. You'll get a public URL like `trade-autopsy.vercel.app`.

## Run locally first (optional, recommended before deploying)

```bash
npm install
cp .env.local.example .env.local
# paste your real key into .env.local
npm run dev
```

Then open http://localhost:3000

## Supported chains

X Layer, Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain — all via public
RPC endpoints, no API keys needed for those. Only the Claude analysis step needs
your Anthropic key, and it stays server-side in `app/api/analyze/route.js` — never
exposed to the browser.

## For the OKX.AI submission

- This needs to be live at a public URL before you submit (OKX reviews and lists it).
- Record your 90-second demo using a real transaction hash — ideally one on X Layer,
  since that's the hackathon's home chain, even though the tool works on others too.
- Test with both a successful and a failed/reverted transaction if you can find one,
  since the verdict logic is the most interesting thing to show off.
