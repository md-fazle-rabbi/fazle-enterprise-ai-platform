"use client";

import { useCallback, useEffect, useState } from "react";
import { conversationListSchema, type ConversationSummary } from "@/lib/conversations/browser";

export type ConversationsState =
  { status: "loading" } | { status: "error" } | { status: "ready"; items: ConversationSummary[] };

// Why: null means the list could not be loaded. Kept outside the hook so the mount effect
// can call it without touching state synchronously.
async function fetchConversations(): Promise<ConversationSummary[] | null> {
  try {
    const response = await fetch("/api/conversations");
    const body: unknown = response.ok ? await response.json().catch(() => null) : null;
    const parsed = conversationListSchema.safeParse(body);
    return parsed.success ? parsed.data.conversations : null;
  } catch {
    return null;
  }
}

// Why: a failed refresh keeps a list that is already on screen.
function applyLoad(
  current: ConversationsState,
  items: ConversationSummary[] | null,
): ConversationsState {
  if (items) {
    return { status: "ready", items };
  }
  return current.status === "ready" ? current : { status: "error" };
}

export function useConversations() {
  const [state, setState] = useState<ConversationsState>({ status: "loading" });

  const refresh = useCallback(async (): Promise<void> => {
    const items = await fetchConversations();
    setState((current) => applyLoad(current, items));
  }, []);

  useEffect(() => {
    // Why: "ignore" stops a response from updating state after the panel was unmounted
    // (for example by a workspace switch).
    let ignore = false;
    void fetchConversations().then((items) => {
      if (!ignore) {
        setState((current) => applyLoad(current, items));
      }
    });
    return () => {
      ignore = true;
    };
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      // Why: a 404 means it is already gone, which is what the person wanted.
      if (!response.ok && response.status !== 404) {
        return false;
      }
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", items: current.items.filter((item) => item.id !== id) }
          : current,
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  return { state, refresh, retry, remove };
}
