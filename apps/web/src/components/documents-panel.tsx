import type { DocumentsResult } from "@/lib/documents";

type DocumentsPanelProps = {
  result: Exclude<DocumentsResult, { status: "signed-out" }>;
};

const QUIET_TEXT = "text-sm text-neutral-600 dark:text-neutral-300";

function PanelBody({ result }: DocumentsPanelProps) {
  switch (result.status) {
    case "ok":
      return result.documents.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {result.documents.map((document) => (
            <li key={document.id}>{document.source_path}</li>
          ))}
        </ul>
      ) : (
        <p className={QUIET_TEXT}>No documents for this tenant yet.</p>
      );
    case "no-tenant":
      return <p className={QUIET_TEXT}>This account has no tenant, so there is nothing to show.</p>;
    case "error":
      return (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.message}
        </p>
      );
  }
}

export function DocumentsPanel({ result }: DocumentsPanelProps) {
  return (
    <section
      aria-labelledby="documents-heading"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="documents-heading" className="text-lg font-medium">
        {result.status === "ok" ? `Documents (${result.documents.length})` : "Documents"}
      </h2>
      <PanelBody result={result} />
    </section>
  );
}
