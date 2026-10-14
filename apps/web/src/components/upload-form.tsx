"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { primaryButtonClass } from "@/components/styles";
import { uploadDocument } from "@/lib/upload/client";
import type { UploadSuccess } from "@/lib/upload/result";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string };

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Why: "2", "2 and 4", "2, 4 and 6". A person reads this to find the gap in their file.
function listPages(pages: number[]): string {
  const last = pages.at(-1);
  if (pages.length < 2 || last === undefined) {
    return pages.join("");
  }
  return `${pages.slice(0, -1).join(", ")} and ${last}`;
}

function describeSuccess(name: string, result: UploadSuccess): string {
  if (result.deduplicated) {
    return `${name} is already stored with the same content.`;
  }
  switch (result.kind) {
    case "text":
      return `${name} was stored in ${plural(result.chunkCount, "chunk")}.`;
    case "image":
      return `${name} was read and stored.`;
    case "pdf": {
      const stored = `${name} was stored, ${plural(result.pageCount, "page")} read.`;
      return result.skippedPages.length > 0
        ? `${stored} ${plural(result.skippedPages.length, "page")} had no readable content and ${result.skippedPages.length === 1 ? "was" : "were"} skipped: ${listPages(result.skippedPages)}.`
        : stored;
    }
  }
}

export function UploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const inputId = useId();
  const hintId = useId();
  const uploading = status.kind === "uploading";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Why: the button stays focusable while an upload runs (aria-disabled, not disabled), so
    // a keyboard user does not lose their place. That makes this guard the thing that stops
    // a second upload on top of the first.
    if (uploading) {
      return;
    }
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setStatus({ kind: "failed", message: "Choose a file before uploading." });
      return;
    }

    setStatus({ kind: "uploading" });
    const outcome = await uploadDocument(file);
    if (!outcome.ok) {
      setStatus({ kind: "failed", message: outcome.error.message });
      return;
    }
    setStatus({ kind: "done", message: describeSuccess(file.name, outcome.result) });
    formRef.current?.reset();
    // Why: re-runs the server page, so the new document shows in the list above without a
    // full reload and without losing anything else on the page.
    router.refresh();
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id={headingId} className="text-lg font-medium">
        Upload a document
      </h2>
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Choose a file
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          aria-describedby={hintId}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-neutral-700"
        />
        <p id={hintId} className="text-sm text-neutral-600 dark:text-neutral-300">
          PDF up to 10 MiB and 20 pages. PNG, JPEG or WEBP up to 8 MiB. TXT or MD up to 100,000
          characters.
        </p>
        <div>
          <button
            type="submit"
            aria-disabled={uploading}
            className={`${primaryButtonClass} aria-disabled:opacity-60`}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
      <div role="status" className="text-sm text-neutral-600 dark:text-neutral-300">
        {status.kind === "uploading"
          ? "Uploading. A PDF can take a few minutes, so keep this page open."
          : null}
        {status.kind === "done" ? status.message : null}
      </div>
      {status.kind === "failed" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {status.message}
        </p>
      ) : null}
    </section>
  );
}
