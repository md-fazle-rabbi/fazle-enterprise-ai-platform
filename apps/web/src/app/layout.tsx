import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fazle Enterprise AI Platform",
    template: "%s | Fazle Enterprise AI Platform",
  },
  description: "Web console for the secure enterprise RAG platform.",
};

// Why no next/font: Google Fonts are fetched at build time, which would make Docker builds
// need the internet. The system font stack keeps the build offline and reproducible.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
