import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand">TRADE AUTOPSY</Link>
      <nav className="site-nav" aria-label="Main">
        <Link href="/#examples">Examples</Link>
        <Link href="/#how">How it works</Link>
      </nav>
    </header>
  );
}
