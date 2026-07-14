export const metadata = {
  title: "Trade Autopsy",
  description: "Paste a transaction hash, get a plain-language case report on what actually happened.",
  openGraph: {
    title: "Trade Autopsy",
    description: "Paste any EVM transaction hash — get a plain-language case report on what actually happened, across 21 chains.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trade Autopsy",
    description: "Paste any EVM transaction hash — get a plain-language case report on what actually happened, across 21 chains.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
