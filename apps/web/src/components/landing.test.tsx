import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Landing } from "./landing";

const SIGN_IN_URL = "/api/auth/login?returnTo=%2F";

describe("Landing", () => {
  it("leads with one heading and a sign in link that keeps the return path", () => {
    render(<Landing signInUrl={SIGN_IN_URL} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /survive a security review/i,
    );
    expect(screen.getByRole("link", { name: "Sign in with Keycloak" })).toHaveAttribute(
      "href",
      SIGN_IN_URL,
    );
  });

  it("shows the six measured results", () => {
    render(<Landing signInUrl={SIGN_IN_URL} />);
    const results = screen.getByRole("list", { name: "Measured results" });
    expect(within(results).getAllByRole("listitem")).toHaveLength(6);
    expect(within(results).getByText("p95 1900 ms")).toBeInTheDocument();
  });

  it("shows a sign in error only when there is one", () => {
    const { rerender } = render(<Landing signInUrl={SIGN_IN_URL} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<Landing signInUrl={SIGN_IN_URL} message="Sign in failed. Please try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in failed. Please try again.");
  });

  it("opens every outside link in a new tab without exposing the opener", () => {
    render(<Landing signInUrl={SIGN_IN_URL} />);
    const outside = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("https://"));
    expect(outside.length).toBeGreaterThanOrEqual(3);
    for (const link of outside) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("links the contact email", () => {
    render(<Landing signInUrl={SIGN_IN_URL} />);
    expect(screen.getByRole("link", { name: "mfrabbi.ai@gmail.com" })).toHaveAttribute(
      "href",
      "mailto:mfrabbi.ai@gmail.com",
    );
  });
});
