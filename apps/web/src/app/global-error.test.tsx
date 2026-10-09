import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

// Why: this page renders its own <html>, which cannot be mounted inside Testing Library's
// container div. Rendering to a string checks the content without that problem. The retry
// click is the same one-line wiring as app/error.tsx, whose click is tested there.
describe("GlobalError", () => {
  it("renders its own document with the reference and a retry button", () => {
    const error = Object.assign(new Error("internal detail 12345"), { digest: "abc123" });
    const markup = renderToStaticMarkup(<GlobalError error={error} retry={vi.fn()} />);
    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain("Reference: abc123");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("internal detail");
  });

  it("leaves out the reference when there is no digest", () => {
    const markup = renderToStaticMarkup(<GlobalError error={new Error("x")} retry={vi.fn()} />);
    expect(markup).not.toContain("Reference:");
  });
});
