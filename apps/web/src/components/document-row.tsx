"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { smallButtonClass } from "@/components/styles";
import { deleteDocument } from "@/lib/document-delete/client";

type DocumentRowProps = {
  item: { id: string; source_path: string };
};

export function DocumentRow({ item }: DocumentRowProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDelete(): Promise<void> {
    // Why: the button stays focusable while the delete runs, so this guard is what stops
    // a second request on top of the first.
    if (pending) {
      return;
    }
    setPending(true);
    setFailed(false);
    const deleted = await deleteDocument(item.id);
    if (!deleted) {
      setFailed(true);
      setPending(false);
      return;
    }
    // Why: re-runs the server page, so this row leaves the list without a full reload.
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate" title={item.source_path}>
          {item.source_path}
        </span>
        {confirming ? null : (
          <button
            type="button"
            aria-label={`Delete document: ${item.source_path}`}
            onClick={() => setConfirming(true)}
            className={smallButtonClass}
          >
            Delete
          </button>
        )}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            Delete this document and its stored text? This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={pending}
            className={smallButtonClass}
          >
            {pending ? "Deleting…" : "Confirm delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className={smallButtonClass}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          Could not delete this document.
        </p>
      ) : null}
    </li>
  );
}
