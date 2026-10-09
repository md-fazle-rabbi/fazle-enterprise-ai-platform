import { redirect } from "next/navigation";
import { Landing } from "@/components/landing";
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

// Why this page is also the landing page: proxy.ts sends every signed out visit here, so this
// is the first thing a visitor sees. The route stays /login so the redirect rules and the end
// to end tests do not change.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, returnTo } = await searchParams;
  if (await hasSession()) {
    redirect("/");
  }

  const message = error === undefined ? undefined : ERROR_MESSAGES.get(error);
  const signInUrl = `/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;

  return <Landing message={message} signInUrl={signInUrl} />;
}
