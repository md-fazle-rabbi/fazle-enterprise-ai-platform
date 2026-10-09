import type { ReactNode } from "react";

type ErrorPanelProps = {
  title: string;
  description: string;
  // Why: true only where something actually failed, so a screen reader announces it. A plain
  // "page not found" is not an alert.
  alert?: boolean;
  children?: ReactNode;
};

// Why: one layout for every "not here or not working" page, so the 404 page and the error
// page look like the same product and a later design pass restyles them in one place.
export function ErrorPanel({ title, description, alert = false, children }: ErrorPanelProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p role={alert ? "alert" : undefined} className="text-neutral-600 dark:text-neutral-300">
        {description}
      </p>
      {children}
    </main>
  );
}
