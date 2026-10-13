// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KIB,
  MAX_FILE_NAME_CHARS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_REQUEST_BYTES,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  MIB,
  MULTIPART_OVERHEAD_BYTES,
} from "./limits";

const BACKEND_LIMITS = new URL(
  "../../../../../packages/rag-engine/src/rag_engine/upload_limits.py",
  import.meta.url,
);

// Why: reads a line such as "MAX_IMAGE_BYTES = 8 * MIB" from the backend and works out the
// number, so the web app's copy is checked against the real one and not against itself. It
// understands only what that file uses: integers (with underscores), KIB, MIB and "*".
function backendConstant(source: string, name: string): number {
  const expression = new RegExp(`^${name} = (.+)$`, "m").exec(source)?.[1];
  if (expression === undefined) {
    throw new Error(`${name} was not found in upload_limits.py`);
  }
  return expression.split("*").reduce((product, term) => {
    const word = term.trim();
    if (word === "MIB") {
      return product * MIB;
    }
    if (word === "KIB") {
      return product * KIB;
    }
    if (/^[\d_]+$/.test(word)) {
      return product * Number(word.replaceAll("_", ""));
    }
    throw new Error(`Cannot read "${expression}" for ${name}; update backendConstant`);
  }, 1);
}

describe("upload limits", () => {
  const source = readFileSync(BACKEND_LIMITS, "utf8");

  it.each([
    ["MAX_IMAGE_BYTES", MAX_IMAGE_BYTES],
    ["MAX_PDF_BYTES", MAX_PDF_BYTES],
    ["MAX_TEXT_CHARS", MAX_TEXT_CHARS],
    ["MULTIPART_OVERHEAD_BYTES", MULTIPART_OVERHEAD_BYTES],
  ])("%s matches the backend", (name, value) => {
    expect(value).toBe(backendConstant(source, name));
  });

  it("reads a body up to the same size the backend accepts for a PDF", () => {
    expect(MAX_REQUEST_BYTES).toBe(
      backendConstant(source, "MAX_PDF_BYTES") +
        backendConstant(source, "MULTIPART_OVERHEAD_BYTES"),
    );
  });

  it("keeps a cleaned file name inside the backend's source_path limit", () => {
    expect(MAX_FILE_NAME_CHARS).toBeLessThanOrEqual(
      backendConstant(source, "MAX_SOURCE_PATH_CHARS"),
    );
  });

  it("allows 4 bytes for every text character", () => {
    expect(MAX_TEXT_BYTES).toBe(MAX_TEXT_CHARS * 4);
  });
});
