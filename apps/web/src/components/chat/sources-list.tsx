import { sourceAnchorId } from "@/lib/chat/citations";
import type { ChatResult } from "@/lib/chat/events";

type SourcesListProps = {
  turnId: string;
  result: ChatResult;
};

const BADGE_BASE = "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold";
// Why: a source the answer cited gets the accent badge. A source that was only retrieved gets
// a grey one, and the card border is dashed as well, so the difference is not colour alone.
const BADGE_CITED = `${BADGE_BASE} bg-accent text-white`;
const BADGE_UNCITED = `${BADGE_BASE} bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100`;

// Why: retrieved_context, not citations, is what [N] markers in the answer index into
// (rag_engine/routers/query.py). citations comes from a Python set on the backend, so its
// ORDER cannot be trusted to line up with the numbers in the text. Only membership (does it
// contain this chunk_id) is used here, to mark a source as actually cited.
export function SourcesList({ turnId, result }: SourcesListProps) {
  const { retrieved_context: sources, citations } = result;
  if (sources.length === 0) {
    return null;
  }
  const citedIds = new Set(citations.map((citation) => citation.chunk_id));

  return (
    <div className="text-sm">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Sources</h3>
      <ol className="mt-2 flex flex-col gap-2">
        {sources.map((source, position) => {
          const index = position + 1;
          const cited = citedIds.has(source.chunk_id);
          return (
            <li
              key={source.chunk_id}
              id={sourceAnchorId(turnId, index)}
              tabIndex={-1}
              className={`flex scroll-mt-4 gap-3 rounded-lg border bg-white p-3 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent dark:bg-neutral-950 dark:focus:outline-accent-soft [&:target]:bg-amber-100 dark:[&:target]:bg-amber-900/40 ${
                cited
                  ? "border-neutral-300 dark:border-neutral-700"
                  : "border-dashed border-neutral-300 dark:border-neutral-800"
              }`}
            >
              <span className={cited ? BADGE_CITED : BADGE_UNCITED}>[{index}]</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  {source.heading_path.length > 0 ? (
                    <span>{source.heading_path.join(" › ")}</span>
                  ) : null}
                  {cited ? null : (
                    <span>{source.heading_path.length > 0 ? " · " : ""}considered, not cited</span>
                  )}
                </p>
                <p className="mt-1">{source.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
