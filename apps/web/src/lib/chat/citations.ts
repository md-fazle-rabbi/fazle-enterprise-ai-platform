export type AnswerPart = { type: "text"; text: string } | { type: "citation"; index: number };

// Why: the same pattern the backend uses to find citation markers (rag_engine/generation.py,
// _CITATION_RE = re.compile(r"\[(\d+)\]")). Matching it exactly means a marker the client
// parses is the same one the backend already decided was, or was not, a real citation.
const CITATION_MARKER = /\[(\d+)\]/g;

export function splitAnswer(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let cursor = 0;
  for (const match of answer.matchAll(CITATION_MARKER)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push({ type: "text", text: answer.slice(cursor, start) });
    }
    parts.push({ type: "citation", index: Number(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < answer.length) {
    parts.push({ type: "text", text: answer.slice(cursor) });
  }
  return parts;
}

export function sourceAnchorId(turnId: string, index: number): string {
  return `source-${turnId}-${index}`;
}
