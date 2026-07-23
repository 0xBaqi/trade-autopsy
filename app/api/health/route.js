export async function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "Trade Autopsy",
      version: "1.0.0",
      description: "Plain-English post-mortem for any EVM transaction hash. Supports 21 chains including X Layer, Ethereum, and major L2s.",
      endpoints: {
        detect: "/api/detect",
        analyze: "/api/analyze",
      },
      payment: {
        protocol: "x402",
        version: 2,
        network: "eip155:196",
        price: "$0.01",
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-ACCEPTS-PAYMENT": "x402",
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
      "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, x-payment",
    },
  });
}
