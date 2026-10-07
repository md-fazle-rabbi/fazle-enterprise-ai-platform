"use client";

import { useState } from "react";
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
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="max-h-56 overflow-y-auto md:max-h-none">
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
      <section aria-labelledby="chat-heading" className="flex min-w-0 flex-col gap-4">
        <h2 id="chat-heading" className="text-lg font-medium">
          Chat
        </h2>
        {openFailed ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Could not open that chat. It may have been deleted.
          </p>
        ) : null}
        <div
          role="log"
          aria-label="Conversation"
          aria-live={chat.quiet ? "off" : "polite"}
          aria-busy={locked}
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto"
        >
          {chat.turns.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Ask a question about your documents to get started.
            </p>
          ) : (
            chat.turns.map((turn) => <ChatMessage key={turn.id} turn={turn} />)
          )}
        </div>
        <ChatForm busy={chat.busy} onAsk={chat.ask} onStop={chat.stop} />
      </section>
    </div>
  );
}
