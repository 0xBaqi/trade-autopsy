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
  SWAP: "SWAP",
  BRIDGE: "BRIDGE",
  TOKEN_APPROVAL: "APPROVAL",
  APPROVAL: "APPROVAL",
  PERMIT2_PERMISSION: "PERMIT2 PERMISSION",
  ERC20_TRANSFER: "TOKEN TRANSFER",
  NFT_TRANSFER: "NFT TRANSFER",
  NFT_MINT: "NFT MINT",
  NFT_BURN: "NFT BURN",
  NATIVE_TRANSFER: "NATIVE TRANSFER",
  CONTRACT_CREATION: "CONTRACT CREATION",
  CONTRACT_INTERACTION: "CONTRACT INTERACTION",
  FAILED: "FAILED ATTEMPT",
  UNKNOWN: "UNKNOWN ACTION",
};

function short(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatReadableAmount(value) {
  const text = String(value ?? "").trim();
  if (!text) return text;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  if (!fraction) return `${negative ? "-" : ""}${whole}`;

  const numeric = Number(unsigned);
  if (!Number.isFinite(numeric)) return text;

  let maxDecimals = 4;
  if (numeric > 0 && numeric < 0.0001) maxDecimals = 8;
  else if (numeric < 1) maxDecimals = 6;

  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function displayAmount(asset) {
  if (!asset) return null;
  const amount = asset.amount ?? asset.rawAmount;
  if (amount == null) return null;
  return `${formatReadableAmount(amount)} ${asset.symbol || "token"}`;
}

function nftLabel(transfer) {
  if (!transfer) return "NFT/item";
  if (transfer.standard === "ERC721") return `ERC-721 NFT #${transfer.tokenId}`;
  const quantity = transfer.quantity && transfer.quantity !== "1" ? ` × ${transfer.quantity}` : "";
  return `ERC-1155 item #${transfer.tokenId}${quantity}`;
}

function nftMovementText(transfer, wallet) {
  const fromWallet = transfer?.from?.toLowerCase() === wallet;
  const toWallet = transfer?.to?.toLowerCase() === wallet;
  const label = nftLabel(transfer);
  if (fromWallet && !toWallet) return `${label} left the sender wallet for ${short(transfer.to)}.`;
  if (toWallet && !fromWallet) return `${label} entered the sender wallet from ${short(transfer.from)}.`;
  return `${label} moved from ${short(transfer.from)} to ${short(transfer.to)}.`;
}

function buildEvidenceTrail(caseData) {
  const items = [];
  const classification = caseData?.classification || {};
  const type = classification.type;
  const out = caseData?.assetFlows?.assetsOut?.[0];
  const incoming = caseData?.assetFlows?.assetsIn?.[0];
  const nftTransfers = Array.isArray(caseData?.nftTransfers) ? caseData.nftTransfers : [];
  const wallet = caseData?.from?.toLowerCase();
  const walletNftTransfers = wallet ? nftTransfers.filter((transfer) => transfer?.from?.toLowerCase() === wallet || transfer?.to?.toLowerCase() === wallet) : [];

  items.push({ tone: "proved", text: `Transaction confirmed on ${caseData.chain.name} at block ${caseData.blockNumber}.` });
  items.push({ tone: caseData.success ? "proved" : "warning", text: caseData.success ? "The chain marked this transaction as successful." : "The chain marked this transaction as reverted." });

  if (type === "BRIDGE" && classification.bridge) {
    const bridge = classification.bridge;
    const chainNames = { "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis", "137": "Polygon", "324": "zkSync Era", "8453": "Base", "42161": "Arbitrum", "59144": "Linea" };
    const protocol = bridge.protocol === "ACROSS" ? "Across" : bridge.protocol;
    items.push({ tone: "proved", text: `${protocol || "Bridge"} deposit evidence was observed from a verified bridge contract.` });
    if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender during this transaction.` });
    if (bridge.destinationChainId) items.push({ tone: "detail", text: `Destination: ${chainNames[String(bridge.destinationChainId)] || `chain ${bridge.destinationChainId}`}.` });
    if (bridge.depositId) items.push({ tone: "detail", text: `Deposit ID: ${bridge.depositId}.` });
    items.push({ tone: "warning", text: "Destination delivery is not proven by this origin transaction alone." });
  } else if (type === "SWAP") {
    items.push({ tone: "proved", text: "The transaction matched verified swap evidence." });
    if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` });
    if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet in the same transaction.` });
  } else if (type === "TOKEN_APPROVAL") {
    items.push({ tone: "proved", text: "The calldata matched the standard ERC-20 approval function." });
    if (classification.approval?.spender) items.push({ tone: "detail", text: `Spender: ${short(classification.approval.spender)}.` });
  } else if (type === "ERC20_TRANSFER" || type === "NATIVE_TRANSFER") {
    if (out) items.push({ tone: "proved", text: `${displayAmount(out)} left the sender.` });
    if (incoming) items.push({ tone: "proved", text: `${displayAmount(incoming)} entered the sender wallet.` });
  } else if (type === "NFT_MINT") {
    for (const transfer of classification?.nft?.transfers || []) {
      items.push({ tone: "proved", text: `${nftLabel(transfer)} was minted from the zero address into the sender wallet.` });
    }
    if (out) items.push({ tone: "detail", text: `${displayAmount(out)} also left the sender during this transaction; Trade Autopsy does not assume that was the mint price.` });
    items.push({ tone: "proved", text: "A zero-address origin is deterministic ERC-721/ERC-1155 mint evidence." });
  } else if (type === "NFT_BURN") {
    for (const transfer of classification?.nft?.transfers || []) {
      items.push({ tone: "proved", text: `${nftLabel(transfer)} moved from the sender wallet to the zero address.` });
    }
    items.push({ tone: "proved", text: "A zero-address destination is deterministic ERC-721/ERC-1155 burn evidence." });
  } else if (type === "NFT_TRANSFER") {
    for (const transfer of walletNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) });
    items.push({ tone: "warning", text: "NFT transfer evidence proves movement, not whether it was a purchase, sale, or gift." });
  } else if (type === "CONTRACT_INTERACTION") {
    items.push({ tone: "warning", text: "A contract was called, but the available evidence does not prove one specific higher-level action." });
    for (const transfer of walletNftTransfers) items.push({ tone: "proved", text: nftMovementText(transfer, wallet) });
    if (walletNftTransfers.length > 0) items.push({ tone: "warning", text: "These NFT/item movements are verified, but their economic meaning is not proven by transfer evidence alone." });
  }

  return items;
}

function VerdictStamp({ verdict }) {
  const v = VERDICT_STYLES[verdict] || VERDICT_STYLES.warning;
  const Icon = v.Icon;
  return (
    <div className="stamp-in" style={{ border: `3px solid ${v.color}`, color: v.color, transform: "rotate(-6deg)" }}>
      <Icon size={18} strokeWidth={2.5} />
      <span>{v.label}</span>
    </div>
  );
}

function ActionBadge({ type }) {
  const label = ACTION_LABELS[type] || (type ? type.replaceAll("_", " ") : "UNKNOWN ACTION");
  return <div className="action-badge"><span className="action-dot" />ACTION · {label}</div>;
}

function ActionSequence({ sequence }) {
  const steps = sequence?.steps || [];
  if (steps.length < 2) return null;
  const orderVerified = sequence.ordering === "VERIFIED_COMMAND_ORDER";
  return (
    <div className="sequence-box">
      <div className="sequence-label">Action sequence</div>
      <div className="sequence-steps">{steps.map((step,index)=><span key={`${step.type}-${index}`} className="sequence-part"><span className="sequence-step">{ACTION_LABELS[step.type] || step.type.replaceAll("_", " ")}</span>{index<steps.length-1&&<span className="sequence-arrow">→</span>}</span>)}</div>
      <div className="sequence-note">{orderVerified ? "Order verified from the transaction command stream." : "Multiple actions detected; exact order is not proven."}</div>
    </div>
  );
}

export default function TradeAutopsy() {
  const [hash, setHash] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [caseData, setCaseData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [caseNum, setCaseNum] = useState(null);

  useEffect(() => { setCaseNum(Math.floor(1000 + Math.random() * 8999)); }, []);

  async function detectCase() {
    const cleanHash = hash.trim();
    setStatus("detecting"); setErrorMsg(""); setCandidates([]); setCaseData(null); setAnalysis(null);
    try {
      const res = await fetch("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: cleanHash }) });
      const json = await res.json();
      if (!res.ok) { setStatus("error"); setErrorMsg(json.error || "Something went wrong detecting the chain."); return; }
      setCandidates(json.candidates || []); setStatus("confirm");
    } catch { setStatus("error"); setErrorMsg("Couldn't reach the server. Check your connection and try again."); }
  }

  async function confirmChain(candidate) {
    setStatus("loading"); setErrorMsg("");
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: hash.trim(), chainId: candidate.chainId }) });
      const json = await res.json();
      if (!res.ok) { setStatus("error"); setErrorMsg(json.error || "Something went wrong pulling this transaction."); return; }
      setCaseData(json.caseData); setAnalysis(json.analysis); setStatus("done");
    } catch { setStatus("error"); setErrorMsg("Couldn't reach the server. Check your connection and try again."); }
  }

  return (
    <div className="autopsy-root">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Sans+3:wght@400;500;600;700&display=swap');
        .autopsy-root{min-height:100vh;background:#EDE9E0;background-image:radial-gradient(circle at 1px 1px,rgba(27,27,24,.06) 1px,transparent 0);background-size:22px 22px;font-family:'Source Sans 3',sans-serif;color:#1B1B18;padding:32px 16px 64px;display:flex;justify-content:center}.autopsy-container{width:100%;max-width:640px}.case-header{margin-bottom:28px}.case-eyebrow,.intake-label,.report-meta,.fact,.raw-toggle,.action-badge,.evidence-title,.sequence-label,.sequence-step,.sequence-note{font-family:'IBM Plex Mono',monospace}.case-eyebrow{font-size:12px;letter-spacing:.12em;color:#7A7568;text-transform:uppercase;margin-bottom:6px}.case-title{font-family:'Special Elite',monospace;font-size:34px;line-height:1.15;margin:0}.case-sub{font-size:15px;color:#4A463D;margin-top:10px;max-width:46ch;line-height:1.5}.intake{background:#F7F4EC;border:1px solid #D8D2C2;border-radius:4px;padding:18px;box-shadow:0 1px 0 rgba(27,27,24,.04);margin-bottom:24px}.intake-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7A7568;margin-bottom:8px;display:block}.intake-row{display:flex;gap:8px}.intake-input{flex:1;font-family:'IBM Plex Mono',monospace;font-size:13px;padding:11px 12px;border:1px solid #C9C2AC;border-radius:3px;background:#FFFDF8;color:#1B1B18;outline:none}.intake-input:focus{border-color:#2F5D62;box-shadow:0 0 0 2px rgba(47,93,98,.15)}.intake-btn{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;background:#1B1B18;color:#F7F4EC;border:none;border-radius:3px;padding:0 18px;display:flex;align-items:center;gap:6px;cursor:pointer}.intake-btn:disabled{opacity:.5}.intake-hint{font-size:12px;color:#948C78;margin-top:8px}.error-box{background:#FBEDEA;border:1px solid #E3B5AE;color:#8A2E28;padding:12px 14px;border-radius:3px;font-size:13px;margin-bottom:20px;display:flex;gap:8px}.loading-row{font-family:'IBM Plex Mono',monospace;font-size:13px;color:#7A7568;display:flex;align-items:center;gap:10px;padding:20px 0}.dot{width:6px;height:6px;border-radius:50%;background:#2F5D62;animation:pulse 1.1s infinite ease-in-out}.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}@keyframes pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}.confirm-box{background:#F1ECE0;border:1px solid #D8D2C2;border-radius:4px;padding:16px;margin-bottom:20px}.confirm-label{font-size:13px;color:#4A463D;margin-bottom:12px}.confirm-options{display:flex;flex-wrap:wrap;gap:8px}.chain-badge{font-family:'IBM Plex Mono',monospace;font-size:12.5px;background:#FFFDF8;border:1px solid #C9C2AC;border-radius:20px;padding:8px 14px;cursor:pointer}.chain-badge-symbol{font-size:10px;color:#7A7568;background:#EDE9E0;border-radius:10px;padding:2px 6px;margin-left:8px}.report{background:#FFFDF8;border:1px solid #D8D2C2;border-radius:4px;position:relative;overflow:hidden}.report-top{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 20px 0}.report-meta{font-size:11px;color:#948C78;letter-spacing:.06em}.stamp-in{font-family:'Special Elite',monospace;font-size:13px;letter-spacing:.04em;padding:6px 12px;border-radius:4px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;animation:stampSlam .35s cubic-bezier(.2,1.4,.4,1) both;animation-delay:.15s}@keyframes stampSlam{0%{opacity:0;transform:scale(2.2) rotate(-6deg)}70%{opacity:1}100%{opacity:1;transform:scale(1) rotate(-6deg)}}.action-row{padding:13px 20px 0}.action-badge{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.09em;color:#4A463D;background:#F1ECE0;border:1px solid #D8D2C2;border-radius:3px;padding:6px 9px}.action-dot{width:6px;height:6px;border-radius:50%;background:#2F5D62}.sequence-box{margin:12px 20px 0;padding:12px 14px;border:1px dashed #C9C2AC;background:#F7F4EC;border-radius:3px}.sequence-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7A7568;margin-bottom:8px}.sequence-steps{display:flex;align-items:center;flex-wrap:wrap;gap:7px}.sequence-part{display:flex;align-items:center;gap:7px}.sequence-step{font-size:10.5px;font-weight:600;letter-spacing:.06em;background:#FFFDF8;border:1px solid #C9C2AC;border-radius:3px;padding:5px 7px}.sequence-arrow{color:#2F5D62}.sequence-note{font-size:9.5px;color:#948C78;margin-top:8px}.report-body{padding:16px 20px 20px}.report-section{margin-bottom:16px}.report-section-label{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#948C78;margin-bottom:4px}.report-section-text{font-size:15px;line-height:1.55;color:#262620}.divider{border:none;border-top:1px dashed #D8D2C2;margin:16px 20px}.facts-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;padding:0 20px 18px}.fact-label{font-size:10px;color:#948C78;text-transform:uppercase;letter-spacing:.06em}.fact-value{font-size:13px;color:#1B1B18;margin-top:2px;word-break:break-all}.evidence{margin:0 20px 18px;border:1px solid #D8D2C2;background:#F7F4EC;border-radius:3px;padding:14px}.evidence-title{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#7A7568;margin-bottom:10px}.evidence-item{display:flex;gap:9px;font-size:13px;line-height:1.45;padding:5px 0;border-top:1px dashed rgba(216,210,194,.7)}.evidence-item:first-of-type{border-top:none}.evidence-mark{font-family:'IBM Plex Mono',monospace;font-weight:600;min-width:14px}.evidence-proved .evidence-mark{color:#2F5D62}.evidence-detail .evidence-mark{color:#7A7568}.evidence-warning .evidence-mark{color:#B0413E}.raw-toggle{width:100%;background:#F1ECE0;border:none;border-top:1px solid #D8D2C2;padding:12px 20px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7A7568;display:flex;justify-content:space-between;cursor:pointer}.raw-body{background:#1B1B18;color:#C9E4B8;font-family:'IBM Plex Mono',monospace;font-size:11.5px;padding:16px 20px;white-space:pre-wrap;word-break:break-all;line-height:1.6}.explorer-link{display:inline-block;margin-top:14px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#2F5D62;text-decoration:none;border-bottom:1px solid #2F5D62}@media(max-width:420px){.facts-grid{grid-template-columns:1fr}.report-top{flex-direction:column;gap:10px}.case-title{font-size:26px}}
      `}} />
      <div className="autopsy-container">
        <div className="case-header"><div className="case-eyebrow">Trade Autopsy · Multi-Chain Case File</div><h1 className="case-title">What actually happened on-chain?</h1><p className="case-sub">Paste any EVM transaction hash — Ethereum, X Layer, and major L2s including Arbitrum, Base, Optimism, zkSync Era, Linea, Scroll, Blast, and more. This opens a case, detects the chain, pulls the raw on-chain evidence, and explains — in plain language — what happened and why.</p></div>
        <div className="intake"><label className="intake-label">Transaction hash</label><div className="intake-row"><input className="intake-input" placeholder="0x…" value={hash} onChange={(e)=>setHash(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&status!=="detecting"&&status!=="loading"&&detectCase()}/><button className="intake-btn" onClick={detectCase} disabled={status==="detecting"||status==="loading"}><Search size={14}/>Detect chain</button></div><div className="intake-hint">Case No. {caseNum??"----"} · Checks 21 chains, you confirm the match</div></div>
        {status==="error"&&<div className="error-box"><AlertTriangle size={16}/><span>{errorMsg}</span></div>}
        {status==="detecting"&&<div className="loading-row"><span className="dot"/><span className="dot"/><span className="dot"/>Checking which chain this hash belongs to…</div>}
        {status==="confirm"&&candidates.length>0&&<div className="confirm-box"><div className="confirm-label">{candidates.length===1?"Found this transaction on one chain. Confirm to open the case:":`Found this hash on ${candidates.length} chains. Tap the one you meant:`}</div><div className="confirm-options">{candidates.map(c=><button key={c.chainId} className="chain-badge" onClick={()=>confirmChain(c)}>{c.chainName}<span className="chain-badge-symbol">{c.symbol}</span></button>)}</div></div>}
        {status==="loading"&&<div className="loading-row"><span className="dot"/><span className="dot"/><span className="dot"/>Pulling evidence from the chain…</div>}
        {status==="done"&&caseData&&analysis&&<div className="report">
          <div className="report-top"><div className="report-meta">CASE #{caseNum??"----"}<br/>{caseData.chain.name.toUpperCase()} · BLOCK {caseData.blockNumber}</div><VerdictStamp verdict={analysis.verdict}/></div>
          <div className="action-row"><ActionBadge type={caseData.classification?.type}/></div>
          <ActionSequence sequence={caseData.actionSequence}/>
          <div className="report-body"><div className="report-section"><div className="report-section-label">Summary</div><div className="report-section-text">{analysis.summary}</div></div><div className="report-section"><div className="report-section-label">Why</div><div className="report-section-text">{analysis.why}</div></div><div className="report-section"><div className="report-section-label">Tip for next time</div><div className="report-section-text">{analysis.tip}</div></div><a className="explorer-link" href={`${caseData.chain.explorer}${caseData.hash}`} target="_blank" rel="noreferrer">View on {caseData.chain.name} explorer →</a></div>
          <hr className="divider"/><div className="facts-grid"><div className="fact"><div className="fact-label">Status</div><div className="fact-value">{caseData.success?"Success":"Reverted"}</div></div><div className="fact"><div className="fact-label">Network fee</div><div className="fact-value">{caseData.feeEth} {caseData.chain.symbol}</div></div><div className="fact"><div className="fact-label">From</div><div className="fact-value">{short(caseData.from)}</div></div><div className="fact"><div className="fact-label">To</div><div className="fact-value">{caseData.to?short(caseData.to):"Contract creation"}</div></div><div className="fact"><div className="fact-label">Gas used</div><div className="fact-value">{caseData.gasUsedPct!=null?`${caseData.gasUsedPct}% of limit`:caseData.gasUsed}</div></div><div className="fact"><div className="fact-label">Token transfers</div><div className="fact-value">{caseData.transferCount}</div></div>{caseData.nftTransferCount>0&&<div className="fact"><div className="fact-label">NFT / item movements</div><div className="fact-value">{caseData.nftTransferCount}</div></div>}</div>
          <div className="evidence"><div className="evidence-title">Evidence trail</div>{buildEvidenceTrail(caseData).map((item,index)=><div className={`evidence-item evidence-${item.tone}`} key={`${item.text}-${index}`}><span className="evidence-mark">{item.tone==="proved"?"✓":item.tone==="warning"?"!":"→"}</span><span>{item.text}</span></div>)}</div>
          <button className="raw-toggle" onClick={()=>setShowRaw(s=>!s)}>Technical evidence{showRaw?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button>{showRaw&&<div className="raw-body">{JSON.stringify(caseData,null,2)}</div>}
        </div>}
      </div>
    </div>
  );
}
