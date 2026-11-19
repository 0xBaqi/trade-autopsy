"use client";

import { useEffect, useState } from "react";
import { Check, TriangleAlert, ArrowRight } from "lucide-react";
import { ACTION_LABELS, buildEvidenceTrail, headlineFor, short } from "../lib/caseView";
import LookupForm from "./LookupForm";

const VERDICTS = {
  clean: { label: "Routine", tone: "ok" },
  costly: { label: "High cost", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  warning: { label: "Needs review", tone: "warn" },
};

function actionLabel(type) {
  return ACTION_LABELS[type] || (type ? type.replaceAll("_", " ") : "UNKNOWN ACTION");
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }
  return <button type="button" className="btn btn-primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>;
}

function Header({ caseData, analysis }) {
  const v = VERDICTS[analysis.verdict] || VERDICTS.warning;
  const explorer = `${caseData.chain.explorer}${caseData.hash}`;
  const facts = [
    ["Status", caseData.success ? "Success" : "Reverted"],
    ["Network fee", `${caseData.feeEth} ${caseData.chain.symbol}`],
    ["Block", String(caseData.blockNumber)],
    ["Token transfers", String(caseData.transferCount ?? 0)],
  ];
  return (
    <section className="card head">
      <div className="badges">
        <span className={`pill pill-${v.tone}`}>{v.label}</span>
        <span className="pill pill-plain">{actionLabel(caseData.classification?.type)}</span>
      </div>
      <h1 className="title">{headlineFor(caseData.classification?.type, caseData.success)}</h1>
      <p className="summary">{analysis.summary}</p>
      <dl className="facts">
        {facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
      </dl>
      <div className="actions">
        <CopyLinkButton />
        <a className="btn btn-secondary" href={explorer} target="_blank" rel="noreferrer">View on explorer ↗</a>
      </div>
    </section>
  );
}

function Evidence({ caseData }) {
  const items = buildEvidenceTrail(caseData);
  const steps = caseData.actionSequence?.steps || [];
  const out = caseData.assetFlows?.assetsOut || [];
  const inn = caseData.assetFlows?.assetsIn || [];
  const rows = [...out.map((a) => ({ dir: "Out", a })), ...inn.map((a) => ({ dir: "In", a }))];
  return (
    <section className="card">
      <h2 className="label">What the evidence shows</h2>
      {steps.length >= 2 && (
        <p className="steps">
          {steps.map((s, i) => <span key={`${s.type}-${i}`}>{actionLabel(s.type)}{i < steps.length - 1 ? "  →  " : ""}</span>)}
          <span className="muted"> {caseData.actionSequence.ordering === "VERIFIED_COMMAND_ORDER" ? "(order verified)" : "(order not proven)"}</span>
        </p>
      )}
      <ul className="trail">
        {items.map((item, i) => (
          <li key={`${item.text}-${i}`} className={`trail-${item.tone}`}>
            {item.tone === "proved" && <Check size={18} aria-hidden="true" />}
            {item.tone === "warning" && <TriangleAlert size={18} aria-hidden="true" />}
            {item.tone === "detail" && <ArrowRight size={18} aria-hidden="true" />}
            <span>
              {item.tone === "warning" && <strong>Not proved: </strong>}
              {item.text}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="flows">
          {rows.map(({ dir, a }, i) => (
            <div key={`${dir}-${i}`} className="flow">
              <span className={`flow-dir flow-${dir.toLowerCase()}`}>{dir}</span>
              <span className="flow-asset">{a.symbol || "token"}</span>
              <span className="mono">{dir === "Out" ? "−" : "+"}{a.amount ?? a.rawAmount ?? "?"}</span>
            </div>
          ))}
        </div>
      )}
      <p className="legend">Checkmark = read directly from chain data. Warning = the evidence stops short.</p>
    </section>
  );
}

function Explanation({ analysis }) {
  return (
    <section className="card">
      <h2 className="label">In plain words</h2>
      <h3 className="mini">Why</h3>
      <p>{analysis.why}</p>
      <h3 className="mini">Tip for next time</h3>
      <p>{analysis.tip}</p>
      <p className="legend">Written by AI from the evidence on the left. It can be wrong; the facts come from chain data.</p>
    </section>
  );
}

function PermissionsNote() {
  return (
    <p className="note"><strong>Permissions not checked yet.</strong> Whether this transaction left a token permission open is coming next. Do not assume nothing is open.</p>
  );
}

function Technical({ caseData }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <button type="button" className="toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label">Technical evidence</span>
        <span aria-hidden="true">{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open && (
        <>
          <dl className="facts facts-tech">
            <div><dt>From</dt><dd className="mono">{short(caseData.from)}</dd></div>
            <div><dt>To</dt><dd className="mono">{caseData.to ? short(caseData.to) : "Contract creation"}</dd></div>
          </dl>
          <pre className="raw">{JSON.stringify(caseData, null, 2)}</pre>
        </>
      )}
    </section>
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
          <h1 className="title">We couldn't open this case</h1>
          <p>{state.message}</p>
          <p className="muted">{state.code === 429 ? "You have hit the lookup limit. Wait a few minutes and try again." : state.code === 404 ? "Check the hash, or try again if the transaction is very new." : "Try again in a moment."}</p>
        </div>
        <div className="spaced"><LookupForm size="small" /></div>
      </main>
    );
  }

  const { caseData, analysis } = state;
  return (
    <main className="page">
      <div className="case-top">
        <div className="crumb">{caseData.chain.name} · <span className="mono">{short(caseData.hash)}</span></div>
        <div className="case-search"><LookupForm size="small" placeholder="Look up another hash or link" /></div>
      </div>
      <Header caseData={caseData} analysis={analysis} />
      <div className="cols">
        <Evidence caseData={caseData} />
        <div className="col-side">
          <Explanation analysis={analysis} />
          <PermissionsNote />
        </div>
      </div>
      <Technical caseData={caseData} />
    </main>
  );
}
