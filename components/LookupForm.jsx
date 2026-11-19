"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { extractTxHash, casePath } from "../lib/lookup";

export default function LookupForm({ size = "large", placeholder = "0x… or https://etherscan.io/tx/…" }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState(null);
  const [candidates, setCandidates] = useState([]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = extractTxHash(value);
    setError(""); setCandidates([]);
    if (!found) { setError("That doesn't look like a transaction hash. It should start with 0x and be 66 characters long."); return; }
    setBusy(true); setHash(found);
    try {
      const res = await fetch("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash: found }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Something went wrong finding the chain."); return; }
      const list = json.candidates || [];
      if (list.length === 1) { router.push(casePath(list[0].chainId, found)); return; }
      setCandidates(list);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lookup lookup-${size}`}>
      <form className="lookup-row" onSubmit={submit} noValidate>
        <label htmlFor={`lookup-${size}`} className="sr-only">Transaction hash or explorer link</label>
        <input id={`lookup-${size}`} className="lookup-input" type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-describedby={error ? `lookup-err-${size}` : undefined} />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Finding chain…" : "Open case"}</button>
      </form>
      {error && <p id={`lookup-err-${size}`} className="lookup-error" role="alert">{error}</p>}
      {candidates.length > 1 && (
        <div className="lookup-choose" role="group" aria-label="Choose the chain">
          <p>This hash exists on {candidates.length} chains. Which one did you mean?</p>
          <div className="chip-row">
            {candidates.map((c) => (
              <button key={c.chainId} type="button" className="chip chip-button" onClick={() => router.push(casePath(c.chainId, hash))}>{c.chainName}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
