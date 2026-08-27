"""
Semantic chunking: token-aware, structure-aware for markdown. Not
fixed-size character splitting. Chunk boundaries respect heading structure
first, then pack whole paragraphs up to a token budget, only splitting a
single paragraph if it alone exceeds the budget.
"""
import re
from dataclasses import dataclass, field

import tiktoken

_ENCODING = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_ENCODING.encode(text))


@dataclass
class Chunk:
    text: str
    token_count: int
    heading_path: list[str] = field(default_factory=list)
    chunk_index: int = 0


@dataclass
class _Section:
    heading_path: list[str]
    body: str


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$", re.MULTILINE)


def _split_into_sections(text: str) -> list[_Section]:
    """Splits on markdown heading lines, tracks a heading stack so each
    section knows its full parent path."""
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        return [_Section(heading_path=[], body=text)] if text.strip() else []

    sections: list[_Section] = []
    stack: list[tuple[int, str]] = []

    if matches[0].start() > 0:
        preamble = text[: matches[0].start()]
        if preamble.strip():
            sections.append(_Section(heading_path=[], body=preamble))

    for i, match in enumerate(matches):
        level = len(match.group(1))
        title = match.group(2).strip()
        stack = [item for item in stack if item[0] < level]
        stack.append((level, title))
        body_start = match.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections.append(
            _Section(heading_path=[t for _, t in stack], body=text[body_start:body_end])
        )

    return sections


def _split_paragraphs(body: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]


def _split_oversized(paragraph: str, max_tokens: int) -> list[str]:
    """A single paragraph bigger than the whole budget, a big table or code
    block. Falls back to a token-window split, never cuts inside a token."""
    encoded = _ENCODING.encode(paragraph)
    return [
        _ENCODING.decode(encoded[i : i + max_tokens])
        for i in range(0, len(encoded), max_tokens)
    ]


def chunk_markdown(text: str, max_tokens: int = 400) -> list[Chunk]:
    chunks: list[Chunk] = []

    def flush(parts: list[str], heading_path: list[str]) -> None:
        if parts:
            chunk_text = "\n\n".join(parts)
            chunks.append(
                Chunk(
                    text=chunk_text,
                    token_count=count_tokens(chunk_text),
                    heading_path=heading_path,
                    chunk_index=len(chunks),
                )
            )

    for section in _split_into_sections(text):
        parts: list[str] = []
        tokens = 0

        for paragraph in _split_paragraphs(section.body):
            paragraph_tokens = count_tokens(paragraph)

            if paragraph_tokens > max_tokens:
                flush(parts, list(section.heading_path))
                parts, tokens = [], 0
                for piece in _split_oversized(paragraph, max_tokens):
                    chunks.append(
                        Chunk(
                            text=piece,
                            token_count=count_tokens(piece),
                            heading_path=list(section.heading_path),
                            chunk_index=len(chunks),
                        )
                    )
                continue

            if tokens + paragraph_tokens > max_tokens:
                flush(parts, list(section.heading_path))
                parts, tokens = [], 0

            parts.append(paragraph)
            tokens += paragraph_tokens

        flush(parts, list(section.heading_path))

    return chunks