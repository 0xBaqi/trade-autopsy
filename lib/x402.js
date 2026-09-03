// lib/x402.js
// OKX x402 payment protocol implementation for Next.js App Router
// Docs: https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk
// Network: eip155:196 (X Layer mainnet)

const NETWORK = "eip155:196";
const PAY_TO = process.env.PAY_TO_ADDRESS || "0xec84951f801e6310af360d8ed16ca498c2669027";
const PRICE_USD = "0.01"; // $0.01 per analysis
const X402_VERSION = 2;

// Build the payment requirements object that goes in the 402 response header
export function buildPaymentRequired(resourceUrl, description = "Trade Autopsy transaction analysis") {
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        payTo: PAY_TO,
        price: PRICE_USD,
        maxTimeoutSeconds: 60,
        extra: {
          description,
          mimeType: "application/json",
        },
      },
    ],
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description,
      mimeType: "application/json",
    },
  };
}

// Verify payment with OKX facilitator
export async function verifyPayment(paymentPayload, paymentRequirements) {
  const OKX_API_KEY = process.env.OKX_API_KEY;
  const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY;
  const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE;

  // If no OKX API keys configured, skip verification (for free tier / testing)
  if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
    console.warn("[x402] No OKX API keys configured — skipping payment verification");
    return { valid: true, skipped: true };
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements });

  // OKX HMAC-SHA256 signing
  const crypto = await import("crypto");
  const message = timestamp + "POST" + "/api/v6/pay/x402/verify" + body;
  const signature = crypto
    .createHmac("sha256", OKX_SECRET_KEY)
    .update(message)
    .digest("base64");

  try {
    const res = await fetch("https://web3.okx.com/api/v6/pay/x402/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": OKX_API_KEY,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
        "OK-ACCESS-TIMESTAMP": timestamp,
      },
      body,
    });
    const json = await res.json();
    return { valid: json?.data?.valid === true, raw: json };
  } catch (e) {
    console.error("[x402] Verification failed:", e.message);
    return { valid: false, error: e.message };
  }
}

// Check if incoming request has a payment header
export function extractPayment(request) {
  const header = request.headers.get("X-PAYMENT") || request.headers.get("x-payment");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Build a 402 Payment Required response
export function paymentRequiredResponse(resourceUrl, description) {
  const requirements = buildPaymentRequired(resourceUrl, description);
  return new Response(
    JSON.stringify({ error: "Payment required", ...requirements }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, x-payment",
        "X-ACCEPTS-PAYMENT": "x402",
        "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(requirements)).toString("base64"),
      },
    }
  );
}
