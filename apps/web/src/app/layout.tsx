import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fazle Enterprise AI Platform",
    template: "%s | Fazle Enterprise AI Platform",
  },
  description: "Web console for the secure enterprise RAG platform.",
};

// Why Geist from the npm package: its font files ship inside the package and next/font serves
// them from this site. A Docker build still needs no internet, and the CSP rule that only
// this site may serve fonts still holds. A Google Fonts fetch would break both.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
