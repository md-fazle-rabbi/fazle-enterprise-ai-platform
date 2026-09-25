import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentsPanel } from "./documents-panel";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

describe("DocumentsPanel", () => {
  it("lists the documents with a count", () => {
    render(
      <DocumentsPanel
        result={{ status: "ok", documents: [{ id: DOCUMENT_ID, source_path: "handbook.md" }] }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Documents (1)" })).toBeInTheDocument();
    expect(screen.getByText("handbook.md")).toBeInTheDocument();
  });

  it("says so when the tenant has no documents", () => {
    render(<DocumentsPanel result={{ status: "ok", documents: [] }} />);
    expect(screen.getByText("No documents for this tenant yet.")).toBeInTheDocument();
  });

  it("says so when the account has no tenant", () => {
    render(<DocumentsPanel result={{ status: "no-tenant" }} />);
    expect(screen.getByText(/has no tenant/)).toBeInTheDocument();
  });

  it("shows an error as an alert", () => {
    render(<DocumentsPanel result={{ status: "error", message: "The backend answered 500" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The backend answered 500");
  });
});
