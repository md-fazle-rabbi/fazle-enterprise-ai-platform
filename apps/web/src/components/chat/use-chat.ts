"use client";

import { useCallback, useRef, useState } from "react";
import { readChatEvents } from "@/lib/chat/client";
import {
  CHAT_ERROR_MESSAGES,
  chatErrorSchema,
  type ChatError,
  type ChatResult,
  type Stage,
} from "@/lib/chat/events";

export type Turn = {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  stage: Stage | null;
  result: ChatResult | null;
  error: ChatError | null;
};

const STOPPED: ChatError = { code: "internal", message: "Generation was stopped." };
const FALLBACK: ChatError = { code: "internal", message: CHAT_ERROR_MESSAGES.internal };

async function errorFromResponse(response: Response): Promise<ChatError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = chatErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : FALLBACK;
}

export function useChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const updateTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      // Why: no server round trip needed, and every browser this app targets has it, so a
      // turn can be added to the list the instant it is asked.
      const id = crypto.randomUUID();
      setTurns((prev) => [
        ...prev,
        { id, question, status: "streaming", stage: null, result: null, error: null },
      ]);
      setBusy(true);
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          updateTurn(id, { status: "error", error: await errorFromResponse(response) });
          return;
        }
        // Why: streamChat on the server always ends with a result or error event (ADR-015),
        // so breaking here is enough; there is no case where the loop should keep going after
        // one of these. Breaking also releases the reader right away instead of waiting for
        // one more read.
        for await (const event of readChatEvents(response.body)) {
          if (event.type === "stage") {
            updateTurn(id, { stage: event.data.stage });
          } else if (event.type === "result") {
            updateTurn(id, { status: "done", result: event.data });
            break;
          } else {
            updateTurn(id, { status: "error", error: event.data });
            break;
          }
        }
      } catch {
        // Why: an aborted fetch also throws. Checking the controller's own signal is what
        // tells the user's own Stop click apart from a real network failure.
        updateTurn(id, { status: "error", error: controller.signal.aborted ? STOPPED : FALLBACK });
      } finally {
        setBusy(false);
        controllerRef.current = null;
      }
    },
    [updateTurn],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { turns, busy, ask, stop };
}
