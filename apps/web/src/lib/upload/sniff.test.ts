// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_FILE_NAME_CHARS, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TEXT_CHARS } from "./limits";
import { classifyUpload, sanitizeFileName } from "./sniff";

const encode = (text: string) => new TextEncoder().encode(text);

function withHeader(header: number[], totalLength: number): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  bytes.set(header);
  return bytes;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

describe("classifyUpload: binary files are judged by their bytes", () => {
  it.each([
    ["a PNG", "photo.png", PNG, "png"],
    ["a JPEG", "photo.jpg", JPEG, "jpeg"],
    ["a WEBP", "photo.webp", WEBP, "webp"],
    ["a PDF", "paper.pdf", PDF, "pdf"],
  ])("recognises %s", (_label, name, header, kind) => {
    expect(classifyUpload(name, withHeader(header, 64))).toEqual({ ok: true, kind });
  });

  it("ignores a wrong file name, because the bytes decide", () => {
    expect(classifyUpload("photo.pdf", withHeader(PNG, 64))).toEqual({ ok: true, kind: "png" });
    expect(classifyUpload("noextension", withHeader(PDF, 64))).toEqual({ ok: true, kind: "pdf" });
  });

  it("finds the PDF header inside the first 1024 bytes, like the backend", () => {
    const bytes = new Uint8Array(2_048);
    bytes.set(PDF, 1_019);
    expect(classifyUpload("a.pdf", bytes)).toEqual({ ok: true, kind: "pdf" });
  });

  it("does not find a PDF header that starts after byte 1019", () => {
    const bytes = new Uint8Array(2_048);
    bytes.set(PDF, 1_020);
    expect(classifyUpload("a.pdf", bytes)).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it.each([
    ["a GIF", "a.gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["a Windows program", "a.exe", [0x4d, 0x5a, 0x90, 0x00]],
    [
      "a RIFF file that is not WEBP",
      "a.wav",
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
    ],
  ])("refuses %s", (_label, name, header) => {
    expect(classifyUpload(name, withHeader(header, 64))).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("refuses an empty file", () => {
    expect(classifyUpload("a.pdf", new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a PDF one byte over its limit and an image one byte over its limit", () => {
    expect(classifyUpload("a.pdf", withHeader(PDF, MAX_PDF_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
      limit: "10 MiB",
    });
    expect(classifyUpload("a.png", withHeader(PNG, MAX_IMAGE_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
      limit: "8 MiB",
    });
  });

  it("accepts a PDF and an image of exactly their limit", () => {
    expect(classifyUpload("a.pdf", withHeader(PDF, MAX_PDF_BYTES))).toEqual({
      ok: true,
      kind: "pdf",
    });
    expect(classifyUpload("a.png", withHeader(PNG, MAX_IMAGE_BYTES))).toEqual({
      ok: true,
      kind: "png",
    });
  });
});

describe("classifyUpload: .txt and .md must be real UTF-8 text", () => {
  it("returns the decoded text", () => {
    expect(classifyUpload("notes.md", encode("# Refunds\nWithin 30 days."))).toEqual({
      ok: true,
      kind: "text",
      text: "# Refunds\nWithin 30 days.",
    });
  });

  it("matches the extension in any letter case", () => {
    expect(classifyUpload("NOTES.TXT", encode("hello"))).toMatchObject({ ok: true, kind: "text" });
  });

  it("drops a leading byte order mark", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("hello")]);
    expect(classifyUpload("a.txt", withBom)).toEqual({ ok: true, kind: "text", text: "hello" });
  });

  it("keeps non ASCII text intact", () => {
    expect(classifyUpload("a.md", encode("Zurück, 日本語, 😀"))).toEqual({
      ok: true,
      kind: "text",
      text: "Zurück, 日本語, 😀",
    });
  });

  it("refuses bytes that are not valid UTF-8", () => {
    expect(classifyUpload("a.txt", new Uint8Array([0x68, 0xc3, 0x28]))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });

  it("refuses text with a NUL byte", () => {
    expect(classifyUpload("a.txt", encode("he\u0000llo"))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });

  it("refuses a PNG renamed to .txt, because it is not text", () => {
    expect(classifyUpload("a.txt", withHeader(PNG, 64))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });

  it("does not mistake a Markdown file that mentions the PDF header for a PDF", () => {
    expect(
      classifyUpload("notes.md", encode("A PDF starts with %PDF-1.7 and a header.")),
    ).toMatchObject({
      ok: true,
      kind: "text",
    });
  });

  it("refuses text that is only whitespace", () => {
    expect(classifyUpload("a.txt", encode(" \n\t "))).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly the character limit and refuses one more", () => {
    expect(classifyUpload("a.txt", encode("a".repeat(MAX_TEXT_CHARS)))).toMatchObject({ ok: true });
    expect(classifyUpload("a.txt", encode("a".repeat(MAX_TEXT_CHARS + 1)))).toEqual({
      ok: false,
      reason: "too_large",
      limit: "100,000 characters",
    });
  });

  it("counts an emoji as one character, like the backend", () => {
    // Why: 60,000 emoji are 120,000 UTF-16 units but only 60,000 characters. Counting units
    // would refuse a file the backend accepts.
    expect(classifyUpload("a.txt", encode("😀".repeat(60_000)))).toMatchObject({ ok: true });
  });

  it("refuses a text file too big to fit the limit without decoding it", () => {
    expect(classifyUpload("a.txt", new Uint8Array(MAX_TEXT_CHARS * 4 + 1).fill(0x61))).toEqual({
      ok: false,
      reason: "too_large",
      limit: "100,000 characters",
    });
  });
});

describe("sanitizeFileName", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\report.pdf", "report.pdf"],
    ["a\u0000b\u202Ec.txt", "abc.txt"],
    ["zero\u200Bwidth.md", "zerowidth.md"],
    ["  two   spaces .md ", "two spaces .md"],
    ["e\u0301.md", "\u00e9.md"],
    ["", "unnamed"],
    ["/", "unnamed"],
    ["\u202E\u202E", "unnamed"],
  ])("cleans %j to %j", (raw, expected) => {
    expect(sanitizeFileName(raw)).toBe(expected);
  });

  it("cuts a long name and keeps the extension", () => {
    const cleaned = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    expect(Array.from(cleaned)).toHaveLength(MAX_FILE_NAME_CHARS);
    expect(cleaned.endsWith(".pdf")).toBe(true);
  });

  it("never cuts an emoji in half", () => {
    const cleaned = sanitizeFileName(`${"😀".repeat(300)}.md`);
    expect(Array.from(cleaned)).toHaveLength(MAX_FILE_NAME_CHARS);
    expect(cleaned.isWellFormed()).toBe(true);
  });

  it("leaves a name that already fits alone", () => {
    expect(sanitizeFileName("refund-policy.md")).toBe("refund-policy.md");
  });
});
