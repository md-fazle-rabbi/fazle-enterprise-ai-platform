"use client";

import { useEffect, useState } from "react";
import { primaryButtonClass } from "@/components/styles";

type Status = "loading" | "active" | "inactive" | "error";

function isActiveResponse(body: unknown): body is { active: boolean } {
  return (
    typeof body === "object" &&
    body !== null &&
    "active" in body &&
    typeof body.active === "boolean"
  );
}

export function KillSwitchPanel() {
  const [status, setStatus] = useState<Status>("loading");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStatus(): Promise<void> {
      try {
        const response = await fetch("/api/admin/kill-switch");
        const body: unknown = response.ok ? await response.json().catch(() => null) : null;
        setStatus(isActiveResponse(body) ? (body.active ? "active" : "inactive") : "error");
      } catch {
        setStatus("error");
      }
    }
    void loadStatus();
  }, []);

  async function activate(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError("A reason is required to activate the kill switch.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", reason: trimmed }),
      });
      if (!response.ok) {
        setError("Could not activate the kill switch.");
        return;
      }
      setStatus("active");
      setReason("");
    } catch {
      setError("Could not activate the kill switch.");
    } finally {
      setPending(false);
    }
  }

  async function deactivate(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/admin/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      });
      if (!response.ok) {
        setError("Could not deactivate the kill switch.");
        return;
      }
      setStatus("inactive");
    } catch {
      setError("Could not deactivate the kill switch.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="kill-switch-heading"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="kill-switch-heading" className="text-lg font-medium">
        Kill switch
      </h2>
      <p role="status" className="text-sm">
        {status === "loading" ? "Checking status…" : null}
        {status === "active" ? (
          <span className="font-medium text-red-700 dark:text-red-400">
            Active — agents are halted
          </span>
        ) : null}
        {status === "inactive" ? (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            Inactive — agents are running normally
          </span>
        ) : null}
        {status === "error" ? "Could not load the status." : null}
      </p>
      {status === "active" ? (
        <button
          type="button"
          onClick={() => void deactivate()}
          disabled={pending}
          className={`w-fit ${primaryButtonClass} disabled:opacity-60`}
        >
          Deactivate
        </button>
      ) : status === "inactive" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="kill-switch-reason" className="text-sm font-medium">
            Reason
          </label>
          <textarea
            id="kill-switch-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            disabled={pending}
            className="rounded-md border border-neutral-300 p-2 text-sm disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={() => void activate()}
            disabled={pending}
            className="w-fit rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
          >
            Activate
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
