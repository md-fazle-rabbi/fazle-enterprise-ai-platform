import Link from "next/link";
import { ChatPanel } from "@/components/chat/chat-panel";
import { requireSession } from "@/lib/auth/session";

export default async function ChatPage() {
  await requireSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
        ← Back to home
      </Link>
      <ChatPanel />
    </main>
  );
}
