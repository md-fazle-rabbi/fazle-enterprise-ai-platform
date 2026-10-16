"use client";

import { useState } from "react";
import { cardClass } from "@/components/styles";
import { ChatForm } from "./chat-form";
import { ChatMessage } from "./chat-message";
import { ConversationList } from "./conversation-list";
import { useChat } from "./use-chat";
import { useConversations } from "./use-conversations";

export function ChatPanel() {
  const history = useConversations();
  const chat = useChat({ onSaved: history.refresh });
  const [openFailed, setOpenFailed] = useState(false);
  // Why: one thing at a time. Switching chats mid-answer would attach the saved exchange to
  // the wrong conversation.
  const locked = chat.busy || chat.opening;

  async function handleOpen(id: string): Promise<void> {
    setOpenFailed(false);
    const outcome = await chat.openConversation(id);
    if (outcome === "failed") {
      setOpenFailed(true);
      // It may have been deleted elsewhere, so the list is probably out of date.
      void history.refresh();
    }
  }

  function handleNew(): void {
    setOpenFailed(false);
    chat.newChat();
  }

  async function handleDelete(id: string): Promise<boolean> {
    const deleted = await history.remove(id);
    if (deleted && chat.conversationId === id) {
      chat.newChat();
    }
    return deleted;
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className={`${cardClass} max-h-56 overflow-y-auto p-3 md:max-h-[75vh]`}>
        <ConversationList
          state={history.state}
          activeId={chat.conversationId}
          disabled={locked}
          onOpen={(id) => void handleOpen(id)}
          onNew={handleNew}
          onRetry={history.retry}
          onDelete={handleDelete}
        />
      </aside>
      <section aria-labelledby="chat-heading" className={`${cardClass} flex min-w-0 flex-col`}>
        {/* Why: the page already has the visible title "Ask your documents", so this heading
            is for screen reader users only, to name the region. */}
        <h2 id="chat-heading" className="sr-only">
          Chat
        </h2>
        {openFailed ? (
          <p
            role="alert"
            className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            Could not open that chat. It may have been deleted.
          </p>
        ) : null}
        <div
          role="log"
          aria-label="Conversation"
          aria-live={chat.quiet ? "off" : "polite"}
          aria-busy={locked}
          className="flex max-h-[60vh] min-h-64 flex-col gap-6 overflow-y-auto p-5"
        >
          {chat.turns.length === 0 ? (
            <p className="m-auto max-w-sm text-center text-sm text-neutral-600 dark:text-neutral-300">
              Ask a question about your documents to get started.
            </p>
          ) : (
            chat.turns.map((turn) => <ChatMessage key={turn.id} turn={turn} />)
          )}
        </div>
        <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
          <ChatForm busy={chat.busy} onAsk={chat.ask} onStop={chat.stop} />
        </div>
      </section>
    </div>
  );
}
