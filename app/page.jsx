import LookupForm from "../components/LookupForm";
import { CHAINS } from "../lib/chains";

const FEATURED = ["Ethereum", "Base", "Arbitrum", "Optimism", "Polygon", "BNB Chain", "Avalanche"];

const STEPS = [
  ["1", "Evidence", "We read the receipt, logs and transfers straight from the chain."],
  ["2", "Reconstruction", "Code, not guesswork, works out who got what and in what order."],
  ["3", "Classification", "The case is labelled swap, bridge, approval or transfer. If unsure, it says unknown."],
  ["4", "Explanation", "Only now does AI put the proven facts into plain words."],
];

const TRUST = [
  ["Facts come from the chain", "Amounts, addresses and status are read by code from RPC data, never written by a model."],
  ["AI only explains", "It receives the proven evidence and turns it into words. It cannot add facts."],
  ["Unknown stays unknown", "If the evidence is incomplete, the case says so instead of guessing."],
];

export default function Home() {
  const rest = CHAINS.length - FEATURED.length;
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">EVM transaction case files · {CHAINS.length} chains</div>
        <h1 className="hero-title">What actually happened on-chain?</h1>
        <p className="hero-sub">Paste a transaction hash or an explorer link. Get a plain-language case file: what moved, what it was, and where the evidence stops.</p>
        <LookupForm size="large" />
        <p className="fineprint">We find the chain for you. No wallet connection, no account.</p>
        <div className="chip-row chip-row-center" aria-label="Supported chains">
          {FEATURED.map((n) => <span key={n} className="chip">{n}</span>)}
          <span className="chip chip-muted">+ {rest} more</span>
        </div>
      </section>

      <section id="how" className="band">
        <h2 className="eyebrow">How a case is built</h2>
        <div className="grid-4">
          {STEPS.map(([n, title, text]) => (
            <div key={n} className="card">
              <div className="step-num">{n}</div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="examples" className="band">
        <h2 className="eyebrow">See a case file</h2>
        <div className="card card-slot">
          <p>Real example cases are coming. They will be verified transactions, never invented ones. Until then, paste any hash above.</p>
        </div>
      </section>

      <section className="band">
        <div className="trust">
          {TRUST.map(([title, text]) => (
            <div key={title}>
              <h3 className="trust-title">{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
