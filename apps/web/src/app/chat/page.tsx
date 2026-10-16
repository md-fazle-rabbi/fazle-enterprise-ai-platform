import Link from "next/link";
import { ChatPanel } from "@/components/chat/chat-panel";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { requireSession } from "@/lib/auth/session";

export default async function ChatPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/"
            className="w-fit rounded-md text-sm text-neutral-600 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:text-neutral-300 dark:hover:text-accent-soft dark:focus-visible:outline-accent-soft"
          >
            ← Back to home
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Ask your documents</h1>
        </div>
        <TenantSwitcher
          tenants={session.data.user.tenants}
          currentTenantId={session.data.currentTenantId}
        />
      </header>
      {/* Why: keyed on the current workspace, so switching workspace remounts the panel and
          it loads that workspace's chats. Without it, the previous workspace's chats and
          conversation would stay on screen after router.refresh(). */}
      <ChatPanel key={session.data.currentTenantId ?? "no-tenant"} />
    </main>
  );
}
