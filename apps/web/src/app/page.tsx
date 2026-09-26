import Link from "next/link";
import { primaryButtonClass } from "@/components/styles";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackendStatus } from "@/components/backend-status";
import { DocumentsPanel } from "@/components/documents-panel";
import { UserPanel } from "@/components/user-panel";
import { requireSession } from "@/lib/auth/session";
import { isBackendReachable } from "@/lib/backend";
import { listDocuments } from "@/lib/documents";

export default async function HomePage() {
  // Why: reads BACKEND_URL when a request arrives, not when `next build` runs, so one
  // build works in any environment.
  await connection();
  const session = await requireSession();
  const [reachable, documents] = await Promise.all([isBackendReachable(), listDocuments(session)]);
  if (documents.status === "signed-out") {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Fazle Enterprise AI Platform</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        Web console for the enterprise RAG platform.
      </p>
      <UserPanel
        username={session.data.user.username}
        email={session.data.user.email}
        tenants={session.data.user.tenants}
        roles={session.data.user.roles}
      />
      <Link href="/chat" className={primaryButtonClass}>
        Go to chat
      </Link>
      <DocumentsPanel result={documents} />
      <BackendStatus reachable={reachable} />
    </main>
  );
}
