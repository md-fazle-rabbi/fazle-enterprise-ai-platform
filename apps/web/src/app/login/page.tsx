import { redirect } from "next/navigation";
import { primaryButtonClass } from "@/components/styles";
import { safeReturnTo } from "@/lib/auth/return-to";
import { getSession } from "@/lib/auth/session";

// Why: a Map, not a plain object. The reason comes from the query string, and a plain object
// would answer for names like "constructor". Unknown reasons show no message at all.
const ERROR_MESSAGES = new Map([
  ["expired", "Your sign in took too long or was already used. Please try again."],
  ["failed", "Sign in failed. Please try again."],
  ["unavailable", "Sign in is not available right now. Please try again in a moment."],
]);

type LoginPageProps = {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
};

async function hasSession(): Promise<boolean> {
  try {
    return (await getSession()) !== null;
  } catch {
    // Why: Redis being down is exactly when this page must still load and show its message.
    return false;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, returnTo } = await searchParams;
  if (await hasSession()) {
    redirect("/");
  }

  const message = error === undefined ? undefined : ERROR_MESSAGES.get(error);
  const signInUrl = `/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      {message ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      ) : null}
      <a href={signInUrl} className={primaryButtonClass}>
        Sign in with Keycloak
      </a>
    </main>
  );
}
