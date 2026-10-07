"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/browser";
import type { ConversationsState } from "./use-conversations";

type ConversationListProps = {
  state: ConversationsState;
  activeId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRetry: () => void;
  onDelete: (id: string) => Promise<boolean>;
};

const NEW_CHAT_CLASS =
  "inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:outline-white";
const SMALL_BUTTON_CLASS =
  "rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800";

type RowProps = {
  item: ConversationSummary;
  active: boolean;
  disabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
};

function ConversationRow({ item, active, disabled, onOpen, onDelete }: RowProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDelete(): Promise<void> {
    setPending(true);
    setFailed(false);
    const deleted = await onDelete(item.id);
    // On success the row is removed by the parent, so there is nothing left to update.
    if (!deleted) {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          disabled={disabled}
          aria-current={active ? "true" : undefined}
          title={item.title}
          className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800 ${active ? "bg-neutral-100 font-medium dark:bg-neutral-800" : ""}`}
        >
          {item.title}
        </button>
        {confirming ? null : (
          <button
            type="button"
            aria-label={`Delete chat: ${item.title}`}
            onClick={() => setConfirming(true)}
            disabled={disabled}
            className={SMALL_BUTTON_CLASS}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {confirming ? (
        <div className="flex gap-2 px-2">
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={pending}
            className={SMALL_BUTTON_CLASS}
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className={SMALL_BUTTON_CLASS}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="px-2 text-xs text-red-700 dark:text-red-400">
          Could not delete this chat.
        </p>
      ) : null}
    </li>
  );
}

export function ConversationList({
  state,
  activeId,
  disabled,
  onOpen,
  onNew,
  onRetry,
  onDelete,
}: ConversationListProps) {
  return (
    <nav aria-label="Past chats" className="flex flex-col gap-3">
      <button type="button" onClick={onNew} disabled={disabled} className={NEW_CHAT_CLASS}>
        New chat
      </button>
      {state.status === "loading" ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">Loading chats…</p>
      ) : null}
      {state.status === "error" ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Could not load past chats.
          </p>
          <button type="button" onClick={onRetry} className={`w-fit ${SMALL_BUTTON_CLASS}`}>
            Try again
          </button>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">No saved chats yet.</p>
      ) : null}
      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {state.items.map((item) => (
            <ConversationRow
              key={item.id}
              item={item}
              active={item.id === activeId}
              disabled={disabled}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
