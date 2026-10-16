import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/styles";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackendStatus } from "@/components/backend-status";
import { DocumentsPanel } from "@/components/documents-panel";
import { UploadForm } from "@/components/upload-form";
import { UserPanel } from "@/components/user-panel";
import { TenantSwitcher } from "@/components/tenant-switcher";
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Fazle Enterprise AI Platform</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        Web console for the enterprise RAG platform.
      </p>
      <UserPanel
        username={session.data.user.username}
        email={session.data.user.email}
        tenants={session.data.user.tenants}
        roles={session.data.user.roles}
      />
      <TenantSwitcher
        tenants={session.data.user.tenants}
        currentTenantId={session.data.currentTenantId}
      />
      {/* Why: "Go to chat" is the one main action on this page, so it is the only accent
          button. Admin is a quieter secondary button next to it. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/chat" className={primaryButtonClass}>
          Go to chat
        </Link>
        {session.data.user.roles.includes("platform-admin") ? (
          <Link href="/admin" className={secondaryButtonClass}>
            Admin
          </Link>
        ) : null}
      </div>
      <DocumentsPanel result={documents} />
      {documents.status === "ok" ? <UploadForm /> : null}
      <BackendStatus reachable={reachable} />
    </main>
  );
}
