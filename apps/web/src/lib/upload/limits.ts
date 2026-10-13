// Why: these numbers copy the backend's limits in
// packages/rag-engine/src/rag_engine/upload_limits.py (ADR-034). The backend stays the real
// gate. The web app checks the same limits first, so a bad file is refused here with one clear
// message and is never forwarded. limits.test.ts reads the Python file and fails if a number
// here drifts from it.
export const KIB = 1024;
export const MIB = 1024 * KIB;

export const MAX_IMAGE_BYTES = 8 * MIB;
export const MAX_PDF_BYTES = 10 * MIB;
export const MAX_TEXT_CHARS = 100_000;
export const MULTIPART_OVERHEAD_BYTES = 64 * KIB;

// Why: the largest request this route will read. It is the biggest file plus room for the
// multipart boundaries and headers, the same sum the backend uses for /ingest/pdf.
export const MAX_REQUEST_BYTES = MAX_PDF_BYTES + MULTIPART_OVERHEAD_BYTES;

// Why: one character takes at most 4 bytes in UTF-8, so a text file above this many bytes
// cannot fit in MAX_TEXT_CHARS. It lets the route refuse it before decoding anything.
export const MAX_TEXT_BYTES = MAX_TEXT_CHARS * 4;

// Why: this is the web app's own choice, not a backend number. It is far below the backend's
// 512 character source_path limit, so a cleaned name always fits. A longer name is cut and
// keeps its extension.
export const MAX_FILE_NAME_CHARS = 200;
