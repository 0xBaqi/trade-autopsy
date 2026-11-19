import "./globals.css";
import SiteHeader from "../components/SiteHeader";

const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";

const DESCRIPTION = "Paste a transaction hash or explorer link. Get a plain-language case file on what actually happened on-chain, across 20 EVM chains.";

export const metadata = {
  title: { default: "Trade Autopsy: what actually happened on-chain?", template: "%s | Trade Autopsy" },
  description: DESCRIPTION,
  openGraph: { title: "Trade Autopsy", description: DESCRIPTION, type: "website" },
  twitter: { card: "summary", title: "Trade Autopsy", description: DESCRIPTION },
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <span>Trade Autopsy. Not financial advice. Read-only: we never ask for your wallet.</span>
          <span>Built by Baqi</span>
        </footer>
      </body>
    </html>
  );
}
