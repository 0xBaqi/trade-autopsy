import { notFound } from "next/navigation";
import CaseView from "../../../../components/CaseView";
import { CHAINS, isValidTxHash } from "../../../../lib/chains";

export async function generateMetadata({ params }) {
  const { chain: chainId, hash } = await params;
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain || !isValidTxHash(hash)) return { title: "Case not found" };
  return {
    title: `Case ${hash.slice(0, 8)}…${hash.slice(-4)} on ${chain.name}`,
    description: `A plain-language case file for a transaction on ${chain.name}.`,
    robots: { index: false },
  };
}

export default async function CasePage({ params }) {
  const { chain: chainId, hash } = await params;
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain || !isValidTxHash(hash)) notFound();
  return <CaseView chainId={chain.id} hash={hash.toLowerCase()} />;
}
