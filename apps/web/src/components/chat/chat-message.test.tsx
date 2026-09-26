import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "./chat-message";
import type { Turn } from "./use-chat";

const BASE: Turn = {
  id: "1",
  question: "How long is the refund window?",
  status: "streaming",
  stage: null,
  result: null,
  error: null,
};

const CITATION = {
  chunk_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: ["Refunds"],
  text: "Customers can request a refund within 30 days.",
};

describe("ChatMessage", () => {
  it("always shows the question", () => {
    render(<ChatMessage turn={BASE} />);
    expect(screen.getByText(/How long is the refund window/)).toBeInTheDocument();
  });

  it("shows a friendly label for the current stage", () => {
    render(<ChatMessage turn={{ ...BASE, stage: "retrieval" }} />);
    expect(screen.getByText(/Searching your documents/)).toBeInTheDocument();
  });

  it("falls back to a generic label before any stage has arrived", () => {
    render(<ChatMessage turn={BASE} />);
    expect(screen.getByText(/^Thinking/)).toBeInTheDocument();
  });

  it("renders the answer and its sources once done", () => {
    const turn: Turn = {
      ...BASE,
      status: "done",
      result: {
        answer: "Within 30 days [1].",
        citations: [CITATION],
        retrieved_context: [CITATION],
        retrieved_but_uncited_count: 0,
        flagged: false,
        flag_reasons: [],
      },
    };
    render(<ChatMessage turn={turn} />);
    expect(screen.getByRole("link", { name: "Jump to source 1" })).toBeInTheDocument();
    expect(screen.getByText("Customers can request a refund within 30 days.")).toBeInTheDocument();
  });

  it("notes when an answer was flagged, without naming why", () => {
    const turn: Turn = {
      ...BASE,
      status: "done",
      result: {
        answer: "Answer.",
        citations: [],
        retrieved_context: [],
        retrieved_but_uncited_count: 0,
        flagged: true,
        flag_reasons: ["output_pii"],
      },
    };
    render(<ChatMessage turn={turn} />);
    expect(screen.getByText(/Flagged for review/)).toBeInTheDocument();
    expect(screen.queryByText(/output_pii/)).not.toBeInTheDocument();
  });

  it("shows an error as an alert", () => {
    const turn: Turn = {
      ...BASE,
      status: "error",
      error: {
        code: "quota",
        message: "The daily usage limit for this workspace has been reached.",
      },
    };
    render(<ChatMessage turn={turn} />);
    expect(screen.getByRole("alert")).toHaveTextContent("daily usage limit");
  });
});
