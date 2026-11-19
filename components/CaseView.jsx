"use client";

import { useEffect, useState } from "react";
import { Check, TriangleAlert, ArrowRight, X, ShieldAlert } from "lucide-react";
import { ACTION_LABELS, buildEvidenceTrail, headlineFor, short } from "../lib/caseView";
import LookupForm from "./LookupForm";

const VERDICTS = {
  clean: { label: "ROUTINE TX", tone: "teal", Icon: Check },
  costly: { label: "HIGH COST", tone: "red", Icon: TriangleAlert },
  failed: { label: "FAILED TX", tone: "red", Icon: X },
  warning: { label: "NEEDS REVIEW", tone: "red", Icon: ShieldAlert },
};

function actionLabel(type) {
  return ACTION_LABELS[type] || (type ? type.replaceAll("_", " ") : "UNKNOWN ACTION");
}

function CopyLinkButton({ className = "btn btn-secondary" }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  return <button type="button" className={className} onClick={copy}>{copied ? "COPIED" : "COPY LINK"}</button>;
}

function Verdict({ caseData, analysis }) {
  const v = VERDICTS[analysis.verdict] || VERDICTS.warning;
  const Icon = v.Icon;
  return (
    <section className="card verdict">
      <div className={`stamp stamp-${v.tone}`}><Icon size={18} strokeWidth={2.6} aria-hidden="true" /><span>{v.label}</span></div>
      <div className="verdict-body">
        <div className="eyebrow">ACTION · {actionLabel(caseData.classification?.type)}</div>
        <h1 className="verdict-title">{headlineFor(caseData.classification?.type, caseData.success)}</h1>
        <p className="verdict-summary">{analysis.summary}</p>
        <div className="verdict-cols">
          <div><div className="eyebrow">WHY</div><p>{analysis.why}</p></div>
          <div><div className="eyebrow">TIP FOR NEXT TIME</div><p>{analysis.tip}</p></div>
        </div>
        <p className="fineprint">Facts above come from chain data. The wording is written by AI and may be wrong.</p>
      </div>
    </section>
  );
}

function Trail({ caseData }) {
  const items = buildEvidenceTrail(caseData);
  const steps = caseData.actionSequence?.steps || [];
  return (
    <section className="card">
      <h2 className="eyebrow">WHAT HAPPENED</h2>
      {steps.length >= 2 && (
        <div className="sequence">
          {steps.map((s, i) => (
            <span key={`${s.type}-${i}`} className="sequence-part">
              <span className="tag">{actionLabel(s.type)}</span>
              {i < steps.length - 1 && <ArrowRight size={14} aria-hidden="true" />}
            </span>
          ))}
          <span className="fineprint">{caseData.actionSequence.ordering === "VERIFIED_COMMAND_ORDER" ? "Order verified from the transaction command stream." : "Multiple actions detected; exact order is not proven."}</span>
        </div>
      )}
      <ul className="trail">
        {items.map((item, i) => (
          <li key={`${item.text}-${i}`} className={`trail-${item.tone}`}>
            {item.tone === "proved" && <Check size={18} aria-hidden="true" />}
            {item.tone === "warning" && <TriangleAlert size={18} aria-hidden="true" />}
            {item.tone === "detail" && <ArrowRight size={18} aria-hidden="true" />}
            <span>
              <strong>{item.tone === "proved" ? "Proved." : item.tone === "warning" ? "Not proved." : "Detail."}</strong> {item.text}
            </span>
          </li>
        ))}
      </ul>
      <div className="legend">
        <span>Proved = read directly from chain data</span>
        <span>Not proved = the evidence stops short</span>
      </div>
    </section>
  );
}

function Flows({ caseData }) {
  const out = caseData.assetFlows?.assetsOut || [];
  const inn = caseData.assetFlows?.assetsIn || [];
  if (out.length + inn.length === 0) return null;
  const rows = [...out.map((a) => ({ dir: "OUT", a })), ...inn.map((a) => ({ dir: "IN", a }))];
  return (
    <section className="card">
      <h2 className="eyebrow">MONEY IN AND OUT (SENDER WALLET)</h2>
      <div className="table-wrap">
        <table className="flows">
          <thead><tr><th>Direction</th><th>Asset</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {rows.map(({ dir, a }, i) => (
              <tr key={`${dir}-${i}`}>
                <td><span className={`dir dir-${dir.toLowerCase()}`}>{dir}</span></td>
                <td>{a.symbol || "token"}</td>
                <td className="num">{dir === "OUT" ? "−" : "+"}{a.amount ?? a.rawAmount ?? "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PermissionsSlot() {
  return (
    <section className="card card-slot">
      <div className="slot-head">
        <h2 className="eyebrow">PERMISSIONS LEFT BEHIND</h2>
        <span className="tag tag-muted">COMING NEXT</span>
      </div>
      <p>Whether this transaction gave anyone permission to move your tokens, and whether that permission is still active today, is not checked yet. Until it is, do not assume there is nothing left open.</p>
    </section>
  );
}

function Technical({ caseData }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <button type="button" className="toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="eyebrow">TECHNICAL EVIDENCE · DECODED DATA</span>
        <span aria-hidden="true">{open ? "HIDE ▴" : "SHOW ▾"}</span>
      </button>
      {open && <pre className="raw">{JSON.stringify(caseData, null, 2)}</pre>}
    </section>
  );
}

function Sidebar({ caseData }) {
  const explorer = `${caseData.chain.explorer}${caseData.hash}`;
  const facts = [
    ["Status", caseData.success ? "Success" : "Reverted"],
    ["Chain", caseData.chain.name],
    ["Block", String(caseData.blockNumber)],
    ["Network fee", `${caseData.feeEth} ${caseData.chain.symbol}`],
    ["From", short(caseData.from)],
    ["To", caseData.to ? short(caseData.to) : "Contract creation"],
    ["Token transfers", String(caseData.transferCount ?? 0)],
  ];
  return (
    <aside className="side">
      <section className="card">
        <h2 className="eyebrow">CASE FACTS</h2>
        <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === "Status" ? (caseData.success ? "ok" : "bad") : ""}>{v}</dd></div>)}</dl>
      </section>
      <section className="card">
        <h2 className="eyebrow">SHARE THIS CASE</h2>
        <CopyLinkButton className="btn btn-primary btn-block" />
        <a className="btn btn-secondary btn-block" href={explorer} target="_blank" rel="noreferrer">VIEW ON EXPLORER ↗</a>
        <p className="fineprint">Anyone with the link sees the same case. No account needed.</p>
      </section>
      <section className="card">
        <h2 className="eyebrow">WHAT TO DO NEXT</h2>
        <ul className="next">
          <li>If you expected this transaction, there is nothing more to do here.</li>
          <li>If you did not sign it, move funds to a new wallet and review the sites connected to the old one.</li>
          <li>Approvals and permissions can outlast a transaction. Check them in your wallet or a revoke tool you trust.</li>
        </ul>
      </section>
    </aside>
  );
}

export default function CaseView({ chainId, hash }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash, chainId }) })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setState({ status: "error", code: res.status, message: json.error || "Something went wrong pulling this transaction." });
        else setState({ status: "done", caseData: json.caseData, analysis: json.analysis });
      })
      .catch(() => live && setState({ status: "error", code: 0, message: "Couldn't reach the server. Check your connection and try again." }));
    return () => { live = false; };
  }, [chainId, hash]);

  if (state.status === "loading") {
    return <main className="page"><p className="loading" role="status"><span className="dot" /><span className="dot" /><span className="dot" />Pulling evidence from the chain…</p></main>;
  }
  if (state.status === "error") {
    return (
      <main className="page">
        <div className="card error-card" role="alert">
          <h1 className="verdict-title">We couldn't open this case</h1>
          <p>{state.message}</p>
          <p className="fineprint">{state.code === 429 ? "You have hit the lookup limit. Wait a few minutes and try again." : state.code === 404 ? "Check the hash, or try again if the transaction is very new." : "Try again in a moment."}</p>
        </div>
        <div className="spaced"><LookupForm size="small" /></div>
      </main>
    );
  }

  const { caseData, analysis } = state;
  return (
    <main className="page">
      <div className="case-top">
        <div className="eyebrow case-id">CASE FILE · {caseData.chain.name.toUpperCase()} · {short(caseData.hash)}</div>
        <div className="case-search"><LookupForm size="small" placeholder="Look up another hash or link" /></div>
      </div>
      <div className="case-grid">
        <div className="case-main">
          <Verdict caseData={caseData} analysis={analysis} />
          <Trail caseData={caseData} />
          <Flows caseData={caseData} />
          <PermissionsSlot />
          <Technical caseData={caseData} />
        </div>
        <Sidebar caseData={caseData} />
      </div>
    </main>
  );
}
