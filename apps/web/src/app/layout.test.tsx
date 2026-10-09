import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout, { metadata } from "./layout";

// Why: Next.js owns the global stylesheet at build time. This unit test verifies the
// document shell without pulling CSS processing into the server-rendering test.
vi.mock("./globals.css", () => ({}));

describe("RootLayout", () => {
  it("exports the expected document metadata", () => {
    expect(metadata).toEqual({
      title: {
        default: "Fazle Enterprise AI Platform",
        template: "%s | Fazle Enterprise AI Platform",
      },
      description: "Web console for the secure enterprise RAG platform.",
    });
  });

  it("renders a semantic document shell around the page content", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Dashboard</main>
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain(
      '<body class="bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">',
    );
    expect(markup).toContain("<main>Dashboard</main>");
    expect(markup).toContain("</body></html>");
  });
});
