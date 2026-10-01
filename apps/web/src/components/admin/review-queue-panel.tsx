"use client";

import { useEffect, useState } from "react";

type ReviewItem = {
  id: string;
  question: string;
  answer: string;
  flag_reasons: string[];
  status: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "no-tenant" }
  | { kind: "error" }
  | { kind: "ok"; items: ReviewItem[] };

function isReviewQueueResponse(
  body: unknown,
): body is { tenantSelected: boolean; items: ReviewItem[] } {
  return (
    typeof body === "object" &&
    body !== null &&
    "tenantSelected" in body &&
    "items" in body &&
    Array.isArray(body.items)
  );
}

function ReviewQueueItemRow({
  item,
  onResolved,
}: {
  item: ReviewItem;
  onResolved: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const response = await fetch(`/api/admin/review-queue/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { note: trimmed } : {}),
      });
      if (!response.ok) {
        setError("Could not resolve this item.");
        return;
      }
      onResolved(item.id);
    } catch {
      setError("Could not resolve this item.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        Flagged: {item.flag_reasons.join(", ")}
      </p>
      <p className="text-sm">
        <span className="font-medium">Question: </span>
        {item.question}
      </p>
      <p className="text-sm">
        <span className="font-medium">Answer: </span>
        {item.answer}
      </p>
      {open ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${item.id}`} className="text-sm font-medium">
            Note (optional)
          </label>
          <textarea
            id={`note-${item.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={pending}
            className="rounded-md border border-neutral-300 p-2 text-sm disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void resolve()}
              disabled={pending}
              className="w-fit rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Confirm resolve
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="w-fit rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Resolve
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ReviewQueuePanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/admin/review-queue");
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        if (!isReviewQueueResponse(body)) {
          setState({ kind: "error" });
        } else {
          setState(body.tenantSelected ? { kind: "ok", items: body.items } : { kind: "no-tenant" });
        }
      } catch {
        setState({ kind: "error" });
      }
    }
    void load();
  }, []);

  function handleResolved(id: string): void {
    setState((current) =>
      current.kind === "ok"
        ? { ...current, items: current.items.filter((item) => item.id !== id) }
        : current,
    );
  }

  return (
    <section
      aria-labelledby="review-queue-heading"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="review-queue-heading" className="text-lg font-medium">
        Review queue
      </h2>
      {state.kind === "loading" ? <p className="text-sm">Loading…</p> : null}
      {state.kind === "no-tenant" ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No workspace selected. Choose one above.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Could not load the review queue.
        </p>
      ) : null}
      {state.kind === "ok" ? (
        state.items.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            No flagged answers right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.items.map((item) => (
              <ReviewQueueItemRow key={item.id} item={item} onResolved={handleResolved} />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
