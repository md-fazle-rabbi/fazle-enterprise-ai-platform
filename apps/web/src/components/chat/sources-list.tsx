import { sourceAnchorId } from "@/lib/chat/citations";
import type { ChatResult } from "@/lib/chat/events";

type SourcesListProps = {
  turnId: string;
  result: ChatResult;
};

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
    <div className="mt-2 text-sm">
      <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Sources</h3>
      <ol className="mt-1 flex flex-col gap-2">
        {sources.map((source, position) => {
          const index = position + 1;
          const cited = citedIds.has(source.chunk_id);
          return (
            <li
              key={source.chunk_id}
              id={sourceAnchorId(turnId, index)}
              tabIndex={-1}
              className={`scroll-mt-4 rounded-md border p-2 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-neutral-900 [&:target]:bg-amber-100 dark:focus:outline-white dark:[&:target]:bg-amber-900/40 ${
                cited
                  ? "border-neutral-300 dark:border-neutral-700"
                  : "border-dashed border-neutral-200 opacity-70 dark:border-neutral-800"
              }`}
            >
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                [{index}]
                {source.heading_path.length > 0 ? ` ${source.heading_path.join(" › ")}` : ""}
                {cited ? "" : " · considered, not cited"}
              </p>
              <p className="mt-1">{source.text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
