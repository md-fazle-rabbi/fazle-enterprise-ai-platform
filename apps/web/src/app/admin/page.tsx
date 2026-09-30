import Link from "next/link";
import { KillSwitchPanel } from "@/components/admin/kill-switch-panel";
import { requireAdminSession } from "@/lib/auth/session";

export default async function AdminPage() {
  await requireAdminSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <KillSwitchPanel />
    </main>
  );
}
