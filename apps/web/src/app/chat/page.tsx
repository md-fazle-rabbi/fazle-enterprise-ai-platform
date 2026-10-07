import Link from "next/link";
import { ChatPanel } from "@/components/chat/chat-panel";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { requireSession } from "@/lib/auth/session";

export default async function ChatPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
        ← Back to home
      </Link>
      <h1 className="text-2xl font-semibold">Ask your documents</h1>
      <TenantSwitcher
        tenants={session.data.user.tenants}
        currentTenantId={session.data.currentTenantId}
      />
      {/* Why: keyed on the current workspace, so switching workspace remounts the panel and
          it loads that workspace's chats. Without it, the previous workspace's chats and
          conversation would stay on screen after router.refresh(). */}
      <ChatPanel key={session.data.currentTenantId ?? "no-tenant"} />
    </main>
  );
}
