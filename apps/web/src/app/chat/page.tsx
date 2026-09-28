import Link from "next/link";
import { ChatPanel } from "@/components/chat/chat-panel";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { requireSession } from "@/lib/auth/session";

export default async function ChatPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
        ← Back to home
      </Link>
      <TenantSwitcher
        tenants={session.data.user.tenants}
        currentTenantId={session.data.currentTenantId}
      />
      <ChatPanel />
    </main>
  );
}
