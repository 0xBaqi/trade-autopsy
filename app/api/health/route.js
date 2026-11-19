import { CHAINS } from "../../../lib/chains";

export async function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "Trade Autopsy",
      version: "1.0.0",
      description: `Plain-English post-mortem for any EVM transaction hash. Supports ${CHAINS.length} chains including Ethereum, X Layer, and major L2s.`,
      endpoints: {
        detect: "/api/detect",
        analyze: "/api/analyze",
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
