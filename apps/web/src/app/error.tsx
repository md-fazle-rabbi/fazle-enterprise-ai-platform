"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ErrorPanel } from "@/components/error-panel";
import { primaryButtonClass } from "@/components/styles";

type ErrorPageProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    // Why: this only writes to the visitor's own browser console. The digest on screen ties
    // the visit to the matching server log line.
    console.error(error);
  }, [error]);

  return (
    <ErrorPanel
      title="Something went wrong"
      description="The page hit an unexpected error. You can try again, or go back to the home page."
      alert
    >
      {/* Why: only the digest is shown, never error.message. A message from a client side
          error can carry internal detail, and this page is the last place to leak it. */}
      {error.digest ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{`Reference: ${error.digest}`}</p>
      ) : null}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => retry()} className={primaryButtonClass}>
          Try again
        </button>
        <Link href="/" className="text-sm text-neutral-600 hover:underline dark:text-neutral-300">
          Back to home
        </Link>
      </div>
    </ErrorPanel>
  );
}
