import { describe, expect, it } from "vitest";
import type { ConversationDetail } from "@/lib/conversations/browser";
import { turnsFromMessages } from "./turns";

type Message = ConversationDetail["messages"][number];

const RESULT: NonNullable<Message["result"]> = {
  answer: "Within 30 days [1]",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

const user = (id: string, content: string): Message => ({
  id,
  role: "user",
  content,
  result: null,
  createdAt: "t",
});
const assistant = (id: string, content: string, result: Message["result"] = null): Message => ({
  id,
  role: "assistant",
  content,
  result,
  createdAt: "t",
});

describe("turnsFromMessages", () => {
  it("turns a question and its answer into one finished turn", () => {
    expect(
      turnsFromMessages([user("u1", "Refunds?"), assistant("a1", "Within 30 days", RESULT)]),
    ).toEqual([
      {
        id: "u1",
        question: "Refunds?",
        status: "done",
        stage: null,
        result: RESULT,
        error: null,
        unsaved: false,
      },
    ]);
  });

  it("shows the plain text when the stored result is not usable", () => {
    const [turn] = turnsFromMessages([user("u1", "Q"), assistant("a1", "Plain answer")]);
    expect(turn?.result).toMatchObject({ answer: "Plain answer", citations: [] });
  });

  it("keeps several exchanges in order", () => {
    const turns = turnsFromMessages([
      user("u1", "First"),
      assistant("a1", "One"),
      user("u2", "Second"),
      assistant("a2", "Two"),
    ]);
    expect(turns.map((turn) => turn.question)).toEqual(["First", "Second"]);
  });

  it("skips a question with no answer and an answer with no question", () => {
    const turns = turnsFromMessages([
      assistant("a0", "Stray answer"),
      user("u1", "Answered"),
      assistant("a1", "Yes"),
      user("u2", "Unanswered"),
    ]);
    expect(turns.map((turn) => turn.question)).toEqual(["Answered"]);
  });

  it("returns nothing for no messages", () => {
    expect(turnsFromMessages([])).toEqual([]);
  });
});
