import Link from "next/link";
import { KillSwitchPanel } from "@/components/admin/kill-switch-panel";
import { ReviewQueuePanel } from "@/components/admin/review-queue-panel";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { requireAdminSession } from "@/lib/auth/session";

export default async function AdminPage() {
  const session = await requireAdminSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <TenantSwitcher
        tenants={session.data.user.tenants}
        currentTenantId={session.data.currentTenantId}
      />
      <KillSwitchPanel />
      {/* Why: keyed on the current tenant so switching workspace remounts this panel and
          refetches, instead of leaving the previous tenant's items on screen. Its own
          useEffect only runs once per mount, and it has no other way to learn the tenant
          changed since it takes no props that would otherwise carry that signal. */}
      <ReviewQueuePanel key={session.data.currentTenantId ?? "no-tenant"} />
    </main>
  );
}
