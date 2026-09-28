"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

type TenantSwitcherProps = {
  tenants: string[];
  currentTenantId: string | null;
};

// Why: there is no tenants table and no display name in Keycloak (documented gap since
// micro-step 3), so the last 4 characters of the id are the only honest, zero-new-
// infrastructure way to tell two workspaces apart at a glance.
function tenantLabel(tenantId: string): string {
  return `Workspace …${tenantId.slice(-4)}`;
}

export function TenantSwitcher({ tenants, currentTenantId }: TenantSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tenants.length <= 1) {
    return null;
  }

  async function handleChange(event: ChangeEvent<HTMLSelectElement>): Promise<void> {
    const tenantId = event.target.value;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) {
        setError("Could not switch workspace. Please try again.");
        return;
      }
      // Why: re-runs server components with fresh data (the new tenant's documents) without
      // a full page reload, so a client component's own state, such as the chat history, is
      // not lost by the switch.
      router.refresh();
    } catch {
      setError("Could not switch workspace. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="tenant-switcher" className="text-sm font-medium">
        Workspace
      </label>
      <select
        id="tenant-switcher"
        value={currentTenantId ?? ""}
        onChange={handleChange}
        disabled={pending}
        className="w-fit rounded-md border border-neutral-300 p-2 text-sm disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
      >
        {tenants.map((tenantId) => (
          <option key={tenantId} value={tenantId}>
            {tenantLabel(tenantId)}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
