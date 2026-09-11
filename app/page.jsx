"use client";

import { useState, useEffect } from "react";
import { Search, FileWarning, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

const VERDICT_STYLES = {
  clean: { label: "ROUTINE TX", color: "#2F5D62", Icon: CheckCircle2 },
  costly: { label: "HIGH COST", color: "#B0413E", Icon: AlertTriangle },
  failed: { label: "FAILED TX", color: "#B0413E", Icon: XCircle },
  warning: { label: "NEEDS REVIEW", color: "#B0413E", Icon: FileWarning },
};

const ACTION_LABELS = {
  SWAP: "SWAP", BRIDGE: "BRIDGE", TOKEN_APPROVAL: "APPROVAL", APPROVAL: "APPROVAL", PERMIT2_PERMISSION: "PERMIT2 PERMISSION",
  ERC20_TRANSFER: "TOKEN TRANSFER", NFT_TRANSFER: "NFT TRANSFER", NFT_MINT: "NFT MINT", NFT_BURN: "NFT BURN",
  NATIVE_TRANSFER: "NATIVE TRANSFER", CONTRACT_CREATION: "CONTRACT CREATION", CONTRACT_INTERACTION: "CONTRACT INTERACTION",
  FAILED: "FAILED ATTEMPT", UNKNOWN: "UNKNOWN ACTION",
};

function short(addr) { if (!addr || addr.length < 10) return addr; return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
function formatReadableAmount(value) {
  const text = String(value ?? "").trim(); if (!text) return text; if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const negative = text.startsWith("-"); const unsigned = negative ? text.slice(1) : text; const [whole, fraction = ""] = unsigned.split(".");
  if (!fraction) return `${negative ? "-" : ""}${whole}`; const numeric = Number(unsigned); if (!Number.isFinite(numeric)) return text;
  let maxDecimals = 4; if (numeric > 0 && numeric < 0.0001) maxDecimals = 8; else if (numeric < 1) maxDecimals = 6;
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, ""); return `${negative ? "-" : ""}${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}
function displayAmount(asset) { if (!asset) return null; const amount = asset.amount ?? asset.rawAmount; if (amount == null) return null; return `${formatReadableAmount(amount)} ${asset.symbol || "token"}`; }
function nftLabel(transfer) { if (!transfer) return "NFT/item"; if (transfer.standard === "ERC721") return `ERC-721 NFT #${transfer.tokenId}`; const quantity = transfer.quantity && transfer.quantity !== "1" ? ` × ${transfer.quantity}` : ""; return `ERC-1155 item #${transfer.tokenId}${quantity}`; }
function nftMovementText(transfer, wallet) { const fromWallet = transfer?.from?.toLowerCase() === wallet; const toWallet = transfer?.to?.toLowerCase() === wallet; const label = nftLabel(transfer); if (fromWallet && !toWallet) return `${label} left the sender wallet for ${short(transfer.to)}.`; if (toWallet && !fromWallet) return `${label} entered the sender wallet from ${short(transfer.from)}.`; return `${label} moved from ${short(transfer.from)} to ${short(transfer.to)}.`; }

function buildEvidenceTrail(caseData) {
  const items = []; const classification = caseData?.classification || {}; const type = classification.type;
  const out = caseData?.assetFlows?.assetsOut?.[0]; const incoming = caseData?.assetFlows?.assetsIn?.[0];
  const nftTransfers = Array.isArray(caseData?.nftTransfers) ? caseData.nftTransfers : []; const wallet = caseData?.from?.toLowerCase();
  const walletNftTransfers = wallet ? nftTransfers.filter((transfer) => transfer?.from?.toLowerCase() === wallet || transfer?.to?.toLowerCase() === wallet) : [];
  const visibleNftTransfers = walletNftTransfers.length > 0 ? walletNftTransfers : nftTransfers;
  items.push({ tone: "proved", text: `Transaction confirmed on ${caseData.chain.name} at block ${caseData.blockNumber}.` });
  items.push({ tone: caseData.success ? "proved" : "warning", text: caseData.success ? "The chain marked this transaction as successful." : "The chain marked this transaction as reverted." });

  if (type === "BRIDGE" && classification.bridge) {
    const bridge = classification.bridge; const chainNames = { "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis", "137": "Polygon", "324": "zkSync Era", "8453": "Base", "42161": "Arbitrum", "59144": "Linea" }; const protocol = bridge.protocol === "ACROSS" ? "Across" : bridge.protocol;
    items.push({ tone: "proved", text: `${protocol || "Bridge"} deposit evidence was observed from a verified bridge contract.` }); if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender during this transaction.` }); if (bridge.destinationChainId) items.push({ tone: "detail", text: `Destination: ${chainNames[String(bridge.destinationChainId)] || `chain ${bridge.destinationChainId}`}.` }); if (bridge.depositId) items.push({ tone: "detail", text: `Deposit ID: ${bridge.depositId}.` }); items.push({ tone: "warning", text: "Destination delivery is not proven by this origin transaction alone." });
  } else if (type === "SWAP") {
    items.push({ tone: "proved", text: "The transaction matched verified swap evidence." }); if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` }); if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet in the same transaction.` });
  } else if (type === "TOKEN_APPROVAL") {
    items.push({ tone: "proved", text: "The calldata matched the standard ERC-20 approval function." }); if (classification.approval?.spender) items.push({ tone: "detail", text: `Spender: ${short(classification.approval.spender)}.` });
  } else if (type === "ERC20_TRANSFER" || type === "NATIVE_TRANSFER") {
    if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` }); if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet.` });
  } else if (type === "NFT_MINT") {
    for (const transfer of classification?.nft?.transfers || []) items.push({ tone: "proved", text: `${nftLabel(transfer)} was created from the zero address and entered the sender wallet.` });
    if (out) items.push({ tone: "detail", text: `${displayAmount(out)} also left the sender in this transaction; this is not automatically labeled as the mint price.` });
    items.push({ tone: "proved", text: "Zero-address origin is standard on-chain evidence that the NFT/item was minted." });
  } else if (type === "NFT_BURN") {
    for (const transfer of classification?.nft?.transfers || []) items.push({ tone: "proved", text: `${nftLabel(transfer)} left the sender wallet for the zero address.` });
    items.push({ tone: "proved", text: "Zero-address destination is standard on-chain evidence that the NFT/item was burned." });
  } else if (type === "NFT_TRANSFER") {
    for (const transfer of visibleNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) }); items.push({ tone: "warning", text: "NFT transfer evidence proves movement, not whether it was a purchase, sale, or gift." });
  } else if (type === "CONTRACT_INTERACTION") {
    items.push({ tone: "warning", text: "A contract was called, but the available evidence does not prove one specific higher-level action." }); for (const transfer of visibleNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) }); if (visibleNftTransfers.length > 0) items.push({ tone: "warning", text: "These ERC-721/ERC-1155 movements are verified, but their economic meaning is not proven by transfer events alone." });
  }
  return items;
}

function VerdictStamp({ verdict }) { const v = VERDICT_STYLES[verdict] || VERDICT_STYLES.warning; const Icon = v.Icon; return <div className="stamp-in" style={{ border: `3px solid ${v.color}`, color: v.color, transform: "rotate(-6deg)" }}><Icon size={18} strokeWidth={2.5} /><span>{v.label}</span></div>; }
function ActionBadge({ type }) { const label = ACTION_LABELS[type] || (type ? type.replaceAll("_", " ") : "UNKNOWN ACTION"); return <div className="action-badge"><span className="action-dot" />ACTION · {label}</div>; }
function ActionSequence({ sequence }) { const steps = sequence?.steps || []; if (steps.length < 2) return null; const orderVerified = sequence.ordering === "VERIFIED_COMMAND_ORDER"; return <div className="sequence-box"><div className="sequence-label">Action sequence</div><div className="sequence-steps">{steps.map((step,index)=><span key={`${step.type}-${index}`} className="sequence-part"><span className="sequence-step">{ACTION_LABELS[step.type] || step.type.replaceAll("_", " ")}</span>{index<steps.length-1&&<span className="sequence-arrow">→</span>}</span>)}</div><div className="sequence-note">{orderVerified ? "Order verified from the transaction command stream." : "Multiple actions detected; exact order is not proven."}</div></div>; }

export default function TradeAutopsy() {
  const [hash, setHash] = useState(""); const [status, setStatus] = useState("idle"); const [errorMsg, setErrorMsg] = useState(""); const [candidates, setCandidates] = useState([]); const [caseData, setCaseData] = useState(null); const [analysis, setAnalysis] = useState(null); const [showRaw, setShowRaw] = useState(false); const [caseNum, setCaseNum] = useState(null);
  useEffect(() => { setCaseNum(Math.floor(1000 + Math.random() * 8999)); }, []);
  async function detectCase() { const cleanHash = hash.trim(); setStatus("detecting"); setErrorMsg(""); setCandidates([]); setCaseData(null); setAnalysis(null); try { const res = await fetch("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: cleanHash }) }); const json = await res.json(); if (!res.ok) { setStatus("error"); setErrorMsg(json.error || "Something went wrong detecting the chain."); return; } setCandidates(json.candidates || []); setStatus("confirm"); } catch { setStatus("error"); setErrorMsg("Network error. Please try again."); } }
  async function analyzeCase(chainId) { setStatus("analyzing"); setErrorMsg(""); try { const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: hash.trim(), chainId }) }); const json = await res.json(); if (!res.ok) { setStatus("error"); setErrorMsg(json.error || "Analysis failed."); return; } setCaseData(json.caseData); setAnalysis(json.analysis); setStatus("done"); } catch { setStatus("error"); setErrorMsg("Network error. Please try again."); } }
  const busy = status === "detecting" || status === "analyzing"; const verdict = analysis ? (VERDICT_STYLES[analysis.verdict] || VERDICT_STYLES.warning) : null; const evidenceTrail = caseData ? buildEvidenceTrail(caseData) : [];
  return (
    <main className="min-h-screen bg-[#F2F0E9] text-[#1A1A17] font-sans">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="mb-10"><div className="font-mono text-xs uppercase tracking-[0.25em] text-[#77756C]">Trade Autopsy · Multi-chain case file</div><h1 className="mt-3 font-mono text-4xl font-black leading-none sm:text-6xl">What actually happened<br/>on-chain?</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-[#56544D]">Paste any EVM transaction hash — Ethereum, X Layer, and major L2s including Arbitrum, Base, Optimism, zkSync Era, Linea, Scroll, Blast, and more. This opens a case, detects the chain, pulls the raw on-chain evidence, and explains — in plain language — what happened and why.</p></header>
        <section className="rounded border border-[#D6D1C4] bg-[#F8F6EF] p-5 shadow-sm sm:p-7"><label className="font-mono text-xs uppercase tracking-[0.18em] text-[#77756C]">Transaction hash</label><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input value={hash} onChange={(e)=>setHash(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!busy)detectCase();}} placeholder="0x…" className="min-w-0 flex-1 rounded border border-[#C8C2B4] bg-[#FBFAF5] px-4 py-4 font-mono text-sm outline-none focus:border-[#2F5D62]"/><button onClick={detectCase} disabled={busy||!hash.trim()} className="flex items-center justify-center gap-2 rounded bg-[#1A1A17] px-6 py-4 font-mono text-sm uppercase tracking-[0.14em] text-white disabled:opacity-40"><Search size={18}/>{status==="detecting"?"Detecting…":"Detect chain"}</button></div><div className="mt-3 text-sm text-[#8A877D]">Case No. {caseNum ?? "----"} · Checks 21 chains, you confirm the match</div></section>
        {status==="confirm"&&<section className="mt-6 rounded border border-[#D6D1C4] bg-[#F8F6EF] p-5"><div className="font-mono text-xs uppercase tracking-[0.18em] text-[#77756C]">Confirm network</div><div className="mt-3 flex flex-wrap gap-2">{candidates.map((c)=><button key={c.id} onClick={()=>analyzeCase(c.id)} className="rounded border border-[#2F5D62] px-4 py-2 font-mono text-sm text-[#2F5D62] hover:bg-[#2F5D62] hover:text-white">{c.name}</button>)}</div></section>}
        {status==="analyzing"&&<div className="mt-6 font-mono text-sm text-[#77756C]">Reconstructing transaction evidence…</div>}
        {status==="error"&&<div className="mt-6 rounded border border-[#D6A5A3] bg-[#FFF1F0] p-4 text-[#9B3431]">{errorMsg}</div>}
        {status==="done"&&caseData&&analysis&&<article className="mt-8 overflow-hidden rounded border border-[#D6D1C4] bg-[#FBFAF5] shadow-sm"><div className="p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><div className="font-mono text-xs uppercase tracking-[0.16em] text-[#77756C]">Case #{caseNum}<br/>{caseData.chain.name} · Block {caseData.blockNumber}</div><VerdictStamp verdict={analysis.verdict}/></div><div className="mt-5"><ActionBadge type={caseData.classification?.type}/></div><div className="mt-7 space-y-6"><div><div className="font-mono text-xs uppercase tracking-[0.18em] text-[#99958A]">Summary</div><p className="mt-2 text-lg leading-8">{analysis.summary}</p></div><div><div className="font-mono text-xs uppercase tracking-[0.18em] text-[#99958A]">Why</div><p className="mt-2 text-lg leading-8">{analysis.why}</p></div><div><div className="font-mono text-xs uppercase tracking-[0.18em] text-[#99958A]">Tip for next time</div><p className="mt-2 text-lg leading-8">{analysis.tip}</p></div></div><a href={`${caseData.chain.explorer}/tx/${caseData.hash}`} target="_blank" rel="noreferrer" className="mt-8 inline-block font-mono text-sm text-[#2F5D62] underline underline-offset-4">View on {caseData.chain.name} explorer →</a><div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-dashed border-[#D6D1C4] pt-6 text-sm"><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">Status</div><div className="mt-1">{caseData.success?"Success":"Failed"}</div></div><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">Network fee</div><div className="mt-1">{formatReadableAmount(caseData.feeEth)} {caseData.chain.symbol}</div></div><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">From</div><div className="mt-1 font-mono">{short(caseData.from)}</div></div><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">To</div><div className="mt-1 font-mono">{short(caseData.to)}</div></div><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">Gas used</div><div className="mt-1">{caseData.gasUsedPct!=null?`${caseData.gasUsedPct}% of limit`:caseData.gasUsed}</div></div><div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">Token transfers</div><div className="mt-1">{caseData.transferCount}</div></div>{caseData.nftTransferCount>0&&<div><div className="font-mono text-xs uppercase tracking-[0.14em] text-[#99958A]">NFT / item movements</div><div className="mt-1">{caseData.nftTransferCount}</div></div>}</div><ActionSequence sequence={caseData.actionSequence}/><div className="mt-7 rounded border border-[#D6D1C4] bg-[#F6F3EA] p-5"><div className="font-mono text-xs uppercase tracking-[0.18em] text-[#77756C]">Evidence trail</div><div className="mt-4 divide-y divide-dashed divide-[#DDD8CC]">{evidenceTrail.map((item,index)=><div key={index} className="flex gap-3 py-3 first:pt-0 last:pb-0"><span className={item.tone==="warning"?"text-[#B0413E]":"text-[#2F5D62]"}>{item.tone==="warning"?"!":"✓"}</span><span>{item.text}</span></div>)}</div></div></div><div className="border-t border-[#D6D1C4] bg-[#F0EDE4]"><button onClick={()=>setShowRaw(!showRaw)} className="flex w-full items-center justify-between px-6 py-5 font-mono text-xs uppercase tracking-[0.18em] text-[#77756C]"><span>Technical evidence</span>{showRaw?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>{showRaw&&<pre className="overflow-x-auto border-t border-[#D6D1C4] p-6 text-xs leading-6">{JSON.stringify(caseData,null,2)}</pre>}</div></article>}
      </div>
    </main>
  );
}
