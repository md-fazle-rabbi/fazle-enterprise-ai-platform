"use client";

import { ChatForm } from "./chat-form";
import { ChatMessage } from "./chat-message";
import { useChat } from "./use-chat";

export function ChatPanel() {
  const { turns, busy, ask, stop } = useChat();

  return (
    <section aria-labelledby="chat-heading" className="flex flex-col gap-4">
      <h2 id="chat-heading" className="text-lg font-medium">
        Chat
      </h2>
      <div
        role="log"
        aria-label="Conversation"
        aria-busy={busy}
        className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto"
      >
        {turns.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Ask a question about your documents to get started.
          </p>
        ) : (
          turns.map((turn) => <ChatMessage key={turn.id} turn={turn} />)
        )}
      </div>
      <ChatForm busy={busy} onAsk={ask} onStop={stop} />
    </section>
  );
}
