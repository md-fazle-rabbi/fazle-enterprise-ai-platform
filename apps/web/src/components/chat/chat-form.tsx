"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { primaryButtonClass } from "@/components/styles";

const MAX_QUESTION_LENGTH = 2_000;

type ChatFormProps = {
  busy: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
};

export function ChatForm({ busy, onAsk, onStop }: ChatFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function submit(): void {
    // Why: the field stays readOnly, not disabled, while busy (see below), so it can still
    // receive a keydown. This is what keeps Enter from sending a second question on top of
    // one still streaming.
    if (busy) {
      return;
    }
    const question = value.trim();
    if (question.length === 0) {
      setError("Type a question before sending.");
      return;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      setError(`Keep questions under ${MAX_QUESTION_LENGTH} characters.`);
      return;
    }
    setError(null);
    onAsk(question);
    setValue("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Why: Shift+Enter still makes a new line. isComposing is checked so pressing Enter to
    // confirm an IME candidate (Japanese, Chinese, Korean input) does not send the message.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="chat-question" className="text-sm font-medium">
        Ask a question
      </label>
      <textarea
        id="chat-question"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        // Why: readOnly, not disabled. A disabled field loses focus the instant it is
        // disabled, which would yank focus away from a keyboard user right after they hit
        // Enter. readOnly blocks typing without moving focus.
        readOnly={busy}
        className={`rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 ${busy ? "opacity-60" : ""}`}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className={`${primaryButtonClass} disabled:opacity-60`}
        >
          {busy ? "Thinking…" : "Send"}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex w-fit items-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Stop
          </button>
        ) : null}
      </div>
    </form>
  );
}
