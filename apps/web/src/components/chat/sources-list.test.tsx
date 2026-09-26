import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatResult } from "@/lib/chat/events";
import { SourcesList } from "./sources-list";

const CITED = {
  chunk_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: ["Refunds"],
  text: "Customers can request a refund within 30 days.",
};
const UNCITED = {
  chunk_id: "33333333-3333-4333-8333-333333333333",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: [],
  text: "General store policy.",
};

function result(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    answer: "Within 30 days [1].",
    citations: [CITED],
    retrieved_context: [CITED, UNCITED],
    retrieved_but_uncited_count: 1,
    flagged: false,
    flag_reasons: [],
    ...overrides,
  };
}

describe("SourcesList", () => {
  it("renders nothing when there is no retrieved context", () => {
    const { container } = render(
      <SourcesList turnId="t1" result={result({ retrieved_context: [], citations: [] })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("numbers each source to match the [N] markers, starting at 1", () => {
    render(<SourcesList turnId="t1" result={result()} />);
    expect(document.getElementById("source-t1-1")).toHaveTextContent("[1]");
    expect(document.getElementById("source-t1-2")).toHaveTextContent("[2]");
  });

  it("shows the heading path for a source that has one", () => {
    render(<SourcesList turnId="t1" result={result()} />);
    expect(screen.getByText(/Refunds/)).toBeInTheDocument();
  });

  it("marks a retrieved source that was not cited", () => {
    render(<SourcesList turnId="t1" result={result()} />);
    expect(document.getElementById("source-t1-2")).toHaveTextContent("considered, not cited");
    expect(document.getElementById("source-t1-1")).not.toHaveTextContent("considered, not cited");
  });

  it("shows the text of each source", () => {
    render(<SourcesList turnId="t1" result={result()} />);
    expect(screen.getByText("General store policy.")).toBeInTheDocument();
  });
});
