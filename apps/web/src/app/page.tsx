import { connection } from "next/server";
import { BackendStatus } from "@/components/backend-status";
import { UserPanel } from "@/components/user-panel";
import { requireSession } from "@/lib/auth/session";
import { isBackendReachable } from "@/lib/backend";

export default async function HomePage() {
  // Why: reads BACKEND_URL when a request arrives, not when `next build` runs, so one
  // build works in any environment.
  await connection();
  const { data } = await requireSession();
  const reachable = await isBackendReachable();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Fazle Enterprise AI Platform</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        Web console for the enterprise RAG platform.
      </p>
      <UserPanel
        username={data.user.username}
        email={data.user.email}
        tenants={data.user.tenants}
        roles={data.user.roles}
      />
      <BackendStatus reachable={reachable} />
    </main>
  );
}
