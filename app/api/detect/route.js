import { NextResponse } from "next/server";
import { CHAINS, rpcCall, isValidTxHash } from "../../../lib/chains";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const hash = (body?.hash || "").trim();
  if (!isValidTxHash(hash)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid transaction hash. It should start with 0x and be 66 characters long." },
      { status: 400 }
    );
  }

  const attempts = CHAINS.map(async (chain) => {
    try {
      const tx = await rpcCall(chain, "eth_getTransactionByHash", [hash]);
      return tx ? { chainId: chain.id, chainName: chain.name, symbol: chain.symbol } : null;
    } catch (e) {
      return { chainId: chain.id, chainName: chain.name, error: e.message };
    }
  });

  const results = await Promise.all(attempts);
  const candidates = results.filter((r) => r && !r.error);
  const failures = results.filter((r) => r && r.error);

  if (candidates.length === 0) {
    if (failures.length === CHAINS.length) {
      return NextResponse.json(
        { error: "Couldn't reach any chain's RPC right now. Try again in a moment.", candidates: [] },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "No transaction found with that hash on any supported chain. Double-check the hash.", candidates: [] },
      { status: 404 }
    );
  }

  return NextResponse.json({ candidates });
}
