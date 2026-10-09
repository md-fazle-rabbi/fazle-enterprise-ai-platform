import type { Metadata } from "next";
import Link from "next/link";
import { ErrorPanel } from "@/components/error-panel";
import { primaryButtonClass } from "@/components/styles";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <ErrorPanel
      title="Page not found"
      description="That address does not match any page here. The link may be mistyped or out of date."
    >
      <Link href="/" className={primaryButtonClass}>
        Go to home
      </Link>
    </ErrorPanel>
  );
}
