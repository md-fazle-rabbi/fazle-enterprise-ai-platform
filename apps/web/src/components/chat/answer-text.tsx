"use client";

import { sourceAnchorId, splitAnswer } from "@/lib/chat/citations";
import type { ChatResult } from "@/lib/chat/events";

type AnswerTextProps = {
  turnId: string;
  result: ChatResult;
};

function jumpToSource(id: string): void {
  const target = document.getElementById(id);
  // Why: the real href already moves the browser there and updates the hash (works with
  // JavaScript disabled too). This call is a supplement, not a replacement: clicking the
  // same marker twice in a row does not re-trigger the browser's own hash navigation,
  // because the hash has not changed. Without this, the second click would do nothing.
  target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  target?.focus();
}

export function AnswerText({ turnId, result }: AnswerTextProps) {
  const parts = splitAnswer(result.answer);
  const sourceCount = result.retrieved_context.length;
  const hasUnresolvedMarker = parts.some(
    (part) => part.type === "citation" && (part.index < 1 || part.index > sourceCount),
  );

  return (
    <div>
      <p>
        {parts.map((part, position) => {
          if (part.type === "text") {
            return <span key={position}>{part.text}</span>;
          }

          const resolvable = part.index >= 1 && part.index <= sourceCount;

          if (!resolvable) {
            return (
              <span
                key={position}
                aria-label="citation not available"
                className="text-neutral-400 dark:text-neutral-600"
              >
                [{part.index}]
              </span>
            );
          }

          const id = sourceAnchorId(turnId, part.index);

          return (
            <a
              key={position}
              href={`#${id}`}
              onClick={() => jumpToSource(id)}
              aria-label={`Jump to source ${part.index}`}
              className="font-medium text-blue-700 no-underline hover:underline dark:text-blue-400"
            >
              [{part.index}]
            </a>
          );
        })}
      </p>
      {hasUnresolvedMarker ? (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Some citation markers in this answer don&apos;t have a matching source.
        </p>
      ) : null}
    </div>
  );
}
