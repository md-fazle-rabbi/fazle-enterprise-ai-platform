import type { Turn } from "./use-chat";

const STAGE_LABELS: Record<string, string> = {
  cache_lookup: "Checking for a cached answer",
  retrieval: "Searching your documents",
  grading: "Checking relevance",
  generation: "Writing an answer",
  output_checks: "Running safety checks",
};

export function ChatMessage({ turn }: { turn: Turn }) {
  return (
    <article className="flex flex-col gap-2 border-b border-neutral-200 pb-4 last:border-b-0 dark:border-neutral-800">
      <p className="text-sm">
        <span className="font-medium">You: </span>
        {turn.question}
      </p>
      {turn.status === "streaming" ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {turn.stage ? (STAGE_LABELS[turn.stage] ?? "Thinking") : "Thinking"}…
        </p>
      ) : null}
      {turn.status === "done" && turn.result ? (
        <div className="text-sm">
          <p>
            <span className="font-medium">Assistant: </span>
            {turn.result.answer}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {turn.result.citations.length} source{turn.result.citations.length === 1 ? "" : "s"}{" "}
            used
            {turn.result.flagged ? " · Flagged for review" : ""}
          </p>
        </div>
      ) : null}
      {turn.status === "error" && turn.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {turn.error.message}
        </p>
      ) : null}
    </article>
  );
}
