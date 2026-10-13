import {
  MAX_FILE_NAME_CHARS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  MIB,
} from "./limits";

export type BinaryKind = "pdf" | "png" | "jpeg" | "webp";

// Why: the type sent to the backend for each kind. FastAPI reads the bytes, not this label,
// so it only has to be honest and consistent.
export const MIME_TYPES: Record<BinaryKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type Classified =
  | { ok: true; kind: BinaryKind }
  | { ok: true; kind: "text"; text: string }
  | { ok: false; reason: "empty" | "unsupported_type" | "invalid_text" }
  | { ok: false; reason: "too_large"; limit: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
// Why: the backend accepts the PDF header anywhere in the first 1024 bytes (check_pdf_header),
// because some real PDFs have a few bytes of junk in front. This matches it.
const PDF_HEADER_WINDOW = 1024;

function matchesAt(bytes: Uint8Array, signature: readonly number[], offset: number): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, PDF_HEADER_WINDOW);
  for (let offset = 0; offset + PDF_SIGNATURE.length <= window.length; offset += 1) {
    if (matchesAt(window, PDF_SIGNATURE, offset)) {
      return true;
    }
  }
  return false;
}

// Why: the file's own bytes decide, never the name or the type the browser sent, because both
// are chosen by the sender.
function detectBinaryKind(bytes: Uint8Array): BinaryKind | null {
  if (matchesAt(bytes, PNG_SIGNATURE, 0)) {
    return "png";
  }
  if (matchesAt(bytes, JPEG_SIGNATURE, 0)) {
    return "jpeg";
  }
  // Why: a WEBP file is "RIFF", a 4 byte size, then "WEBP".
  if (
    matchesAt(bytes, [0x52, 0x49, 0x46, 0x46], 0) &&
    matchesAt(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  return hasPdfHeader(bytes) ? "pdf" : null;
}

function isTextName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".md");
}

function countCodePoints(text: string): number {
  let count = 0;
  for (const _character of text) {
    count += 1;
  }
  return count;
}

// Why: a strict decoder throws on invalid UTF-8 instead of quietly replacing bytes, so a
// binary file renamed to .txt is refused here and not stored as garbage. By default it also
// drops a leading byte order mark.
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function classifyText(bytes: Uint8Array): Classified {
  const limit = `${MAX_TEXT_CHARS.toLocaleString("en-US")} characters`;
  if (bytes.byteLength > MAX_TEXT_BYTES) {
    return { ok: false, reason: "too_large", limit };
  }
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return { ok: false, reason: "invalid_text" };
  }
  // Why: a NUL byte is valid UTF-8 but never appears in a real text file.
  if (text.includes("\u0000")) {
    return { ok: false, reason: "invalid_text" };
  }
  if (text.trim() === "") {
    return { ok: false, reason: "empty" };
  }
  // Why: counted in code points, like Python's len() in the backend. text.length counts UTF-16
  // units, so an emoji would count twice and a valid file could be refused.
  if (countCodePoints(text) > MAX_TEXT_CHARS) {
    return { ok: false, reason: "too_large", limit };
  }
  return { ok: true, kind: "text", text };
}

function classifyBinary(bytes: Uint8Array): Classified {
  const kind = detectBinaryKind(bytes);
  if (kind === null) {
    return { ok: false, reason: "unsupported_type" };
  }
  const max = kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (bytes.byteLength > max) {
    return { ok: false, reason: "too_large", limit: `${max / MIB} MiB` };
  }
  return { ok: true, kind };
}

// Why: the name picks the family, the content has to agree with it. A .txt or .md file must be
// real UTF-8 text. Any other name is judged by its bytes alone. So a Markdown file that talks
// about "%PDF-" is not mistaken for a PDF, and a binary file renamed to .txt is refused.
export function classifyUpload(fileName: string, bytes: Uint8Array): Classified {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "empty" };
  }
  return isTextName(sanitizeFileName(fileName)) ? classifyText(bytes) : classifyBinary(bytes);
}

const FALLBACK_NAME = "unnamed";

// Why: control characters, zero width characters and the bidirectional overrides (U+202A to
// U+202E, U+2066 to U+2069) let a name show as something it is not, for example "txt.exe"
// written to read as "exe.txt". They are dropped. Done by code point and not with a regex,
// because a regex over control characters is flagged by the linter.
function isStrippedCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

// Why: the name is only a label (source_path). It is never used as a path on disk and never
// sent to the model, but it is shown in the document list, so it is cleaned anyway. Only the
// last path segment is kept, so "../../etc/passwd" becomes "passwd".
export function sanitizeFileName(raw: string): string {
  const lastSegment = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = Array.from(lastSegment.normalize("NFC"))
    .filter((character) => !isStrippedCodePoint(character.codePointAt(0) ?? 0))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") {
    return FALLBACK_NAME;
  }
  const characters = Array.from(cleaned);
  if (characters.length <= MAX_FILE_NAME_CHARS) {
    return cleaned;
  }
  // Why: cut the middle and keep the extension, so a long name still says what kind of file
  // it is. Cut by code point, so an emoji is never split in half.
  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? "";
  const keep = MAX_FILE_NAME_CHARS - extension.length;
  return characters.slice(0, keep).join("") + extension;
}
