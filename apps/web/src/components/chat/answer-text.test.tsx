import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatResult } from "@/lib/chat/events";
import { AnswerText } from "./answer-text";

const SOURCE_1 = {
  chunk_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: ["Refunds"],
  text: "Customers can request a refund within 30 days.",
};
const SOURCE_2 = {
  chunk_id: "33333333-3333-4333-8333-333333333333",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: ["Refunds", "Exclusions"],
  text: "Sale items are excluded.",
};

function result(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    answer: "Within 30 days [1].",
    citations: [SOURCE_1],
    retrieved_context: [SOURCE_1],
    retrieved_but_uncited_count: 0,
    flagged: false,
    flag_reasons: [],
    ...overrides,
  };
}

describe("AnswerText", () => {
  it("renders plain text with no markers as plain text", () => {
    render(
      <AnswerText
        turnId="t1"
        result={result({ answer: "No sources needed.", retrieved_context: [], citations: [] })}
      />,
    );
    expect(screen.getByText("No sources needed.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("turns a resolvable marker into a link to its source", () => {
    render(<AnswerText turnId="t1" result={result()} />);
    expect(screen.getByRole("link", { name: "Jump to source 1" })).toHaveAttribute(
      "href",
      "#source-t1-1",
    );
  });

  it("links each marker to the source at its own position, not the cited list's order", () => {
    const withTwo = result({
      answer: "See [1] and [2].",
      retrieved_context: [SOURCE_1, SOURCE_2],
      // Deliberately out of order, matching what the backend's set[int] can produce.
      citations: [SOURCE_2, SOURCE_1],
    });
    render(<AnswerText turnId="t1" result={withTwo} />);
    expect(screen.getByRole("link", { name: "Jump to source 1" })).toHaveAttribute(
      "href",
      "#source-t1-1",
    );
    expect(screen.getByRole("link", { name: "Jump to source 2" })).toHaveAttribute(
      "href",
      "#source-t1-2",
    );
  });

  it("shows an out-of-range marker as plain, non-clickable text", () => {
    render(
      <AnswerText
        turnId="t1"
        result={result({ answer: "See [5].", retrieved_context: [SOURCE_1] })}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByLabelText("citation not available")).toHaveTextContent("[5]");
  });

  it("notes when a cached answer's markers have no matching source", () => {
    render(
      <AnswerText
        turnId="t1"
        result={result({ answer: "Within 30 days [1].", retrieved_context: [], citations: [] })}
      />,
    );
    expect(screen.getByText(/don't have a matching source/)).toBeInTheDocument();
  });

  it("shows no note when every marker resolves", () => {
    render(<AnswerText turnId="t1" result={result()} />);
    expect(screen.queryByText(/don't have a matching source/)).not.toBeInTheDocument();
  });
});
