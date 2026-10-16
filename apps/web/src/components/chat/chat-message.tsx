import { AnswerText } from "./answer-text";
import { SourcesList } from "./sources-list";
import type { Turn } from "./use-chat";

const STAGE_LABELS: Record<string, string> = {
  cache_lookup: "Checking for a cached answer",
  retrieval: "Searching your documents",
  grading: "Checking relevance",
  generation: "Writing an answer",
  output_checks: "Running safety checks",
};

const NOTE_CLASS =
  "rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200";
const FLAG_CLASS =
  "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";

export function ChatMessage({ turn }: { turn: Turn }) {
  return (
    <article className="flex flex-col gap-3">
      {/* Why: the question sits on the right in an accent bubble and the answer on the left in
          a neutral one, so who said what is clear at a glance. The "You" label stays for
          screen readers, because the bubble position carries no meaning for them. */}
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-white">
        <span className="sr-only">You: </span>
        {turn.question}
      </p>
      {turn.status === "streaming" ? (
        <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-accent motion-safe:animate-pulse dark:bg-accent-soft"
          />
          <span>{turn.stage ? (STAGE_LABELS[turn.stage] ?? "Thinking") : "Thinking"}…</span>
        </p>
      ) : null}
      {turn.status === "done" && turn.result ? (
        <div className="flex max-w-[95%] flex-col gap-3 self-start rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Assistant</p>
          <AnswerText turnId={turn.id} result={turn.result} />
          {turn.result.flagged || turn.unsaved ? (
            <p className="flex flex-wrap gap-2">
              {turn.result.flagged ? <span className={FLAG_CLASS}>Flagged for review</span> : null}
              {turn.unsaved ? <span className={NOTE_CLASS}>Not saved to history</span> : null}
            </p>
          ) : null}
          <SourcesList turnId={turn.id} result={turn.result} />
        </div>
      ) : null}
      {turn.status === "error" && turn.error ? (
        <p
          role="alert"
          className="max-w-[95%] self-start rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {turn.error.message}
        </p>
      ) : null}
    </article>
  );
}
