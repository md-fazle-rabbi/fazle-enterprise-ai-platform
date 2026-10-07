import type { ChatError, ChatResult, Stage } from "@/lib/chat/events";
import type { ConversationDetail } from "@/lib/conversations/browser";

export type Turn = {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  stage: Stage | null;
  result: ChatResult | null;
  error: ChatError | null;
  // Set when the server said this exchange could not be saved to history.
  unsaved: boolean;
};

type StoredMessage = ConversationDetail["messages"][number];

function plainResult(answer: string): ChatResult {
  return {
    answer,
    citations: [],
    retrieved_context: [],
    retrieved_but_uncited_count: 0,
    flagged: false,
    flag_reasons: [],
  };
}

// Pairs each stored question with the answer that follows it. Anything that does not form a
// question-then-answer pair is skipped rather than shown half-formed.
export function turnsFromMessages(messages: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (question?.role !== "user" || answer?.role !== "assistant") {
      continue;
    }
    turns.push({
      id: question.id,
      question: question.content,
      status: "done",
      stage: null,
      result: answer.result ?? plainResult(answer.content),
      error: null,
      unsaved: false,
    });
    index += 1;
  }
  return turns;
}
