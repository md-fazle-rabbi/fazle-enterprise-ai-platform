"use client";

import { useCallback, useRef, useState } from "react";
import { readChatEvents } from "@/lib/chat/client";
import { CHAT_ERROR_MESSAGES, chatErrorSchema, type ChatError } from "@/lib/chat/events";
import { conversationDetailSchema } from "@/lib/conversations/browser";
import { turnsFromMessages, type Turn } from "./turns";

export type { Turn } from "./turns";

const STOPPED: ChatError = { code: "internal", message: "Generation was stopped." };
const FALLBACK: ChatError = { code: "internal", message: CHAT_ERROR_MESSAGES.internal };

async function errorFromResponse(response: Response): Promise<ChatError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = chatErrorSchema.safeParse(body);
  return parsed.success ? parsed.data : FALLBACK;
}

export type OpenOutcome = "opened" | "failed" | "stale";

export function useChat(options: { onSaved?: () => void } = {}) {
  const { onSaved } = options;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  // Why: true right after a past chat is loaded, so its messages are not all read aloud.
  const [quiet, setQuiet] = useState(false);
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Why: every ask, new chat or open bumps this, so a slower, older open can tell it has
  // been overtaken and must not overwrite what is on screen.
  const openSeq = useRef(0);

  const setConversationId = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationIdState(id);
  }, []);

  const updateTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      openSeq.current += 1;
      setOpening(false);
      setQuiet(false);
      const id = crypto.randomUUID();
      setTurns((prev) => [
        ...prev,
        {
          id,
          question,
          status: "streaming",
          stage: null,
          result: null,
          error: null,
          unsaved: false,
        },
      ]);
      setBusy(true);
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, conversationId: conversationIdRef.current }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          updateTurn(id, { status: "error", error: await errorFromResponse(response) });
          return;
        }
        // Why: read to the end, not stopped at the result. After it, the server saves the
        // exchange and sends a "history" event with the conversation id (or null).
        for await (const event of readChatEvents(response.body)) {
          if (event.type === "stage") {
            updateTurn(id, { stage: event.data.stage });
          } else if (event.type === "result") {
            updateTurn(id, { status: "done", result: event.data });
          } else if (event.type === "history") {
            if (event.data.conversationId === null) {
              updateTurn(id, { unsaved: true });
            } else {
              setConversationId(event.data.conversationId);
              onSaved?.();
            }
          } else {
            updateTurn(id, { status: "error", error: event.data });
            break;
          }
        }
      } catch {
        // Why: an aborted fetch also throws. Checking the controller's own signal tells the
        // user's own Stop click apart from a real network failure.
        updateTurn(id, { status: "error", error: controller.signal.aborted ? STOPPED : FALLBACK });
      } finally {
        setBusy(false);
        controllerRef.current = null;
      }
    },
    [updateTurn, onSaved, setConversationId],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const openConversation = useCallback(
    async (id: string): Promise<OpenOutcome> => {
      openSeq.current += 1;
      const seq = openSeq.current;
      setOpening(true);
      try {
        const response = await fetch(`/api/conversations/${id}`);
        const body: unknown = response.ok ? await response.json().catch(() => null) : null;
        if (seq !== openSeq.current) {
          return "stale";
        }
        const parsed = conversationDetailSchema.safeParse(body);
        if (!parsed.success) {
          return "failed";
        }
        setQuiet(true);
        setTurns(turnsFromMessages(parsed.data.messages));
        setConversationId(parsed.data.id);
        return "opened";
      } catch {
        return seq === openSeq.current ? "failed" : "stale";
      } finally {
        if (seq === openSeq.current) {
          setOpening(false);
        }
      }
    },
    [setConversationId],
  );

  const newChat = useCallback(() => {
    openSeq.current += 1;
    setOpening(false);
    setQuiet(true);
    setTurns([]);
    setConversationId(null);
  }, [setConversationId]);

  return { turns, busy, opening, quiet, conversationId, ask, stop, openConversation, newChat };
}
