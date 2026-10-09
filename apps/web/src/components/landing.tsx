import { primaryButtonClass, secondaryButtonClass } from "@/components/styles";

const REPO_URL = "https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform";
const PROOF_URL = `${REPO_URL}/tree/main/proof`;
const LINKEDIN_URL = "https://www.linkedin.com/in/fazle-rabbi-ai/";
const CONTACT_EMAIL = "mfrabbi.ai@gmail.com";

// Why: underlined, because a link inside a sentence must be told apart by more than colour.
const linkClass = "text-accent underline hover:no-underline dark:text-accent-soft";
const mutedClass = "text-neutral-600 dark:text-neutral-300";

// Why: these six results are copied by hand from the "At a glance" table in the README, where
// each one links to its proof file. If a number changes there, change it here too.
const MEASURED_RESULTS = [
  {
    label: "Tenant isolation",
    value: "Row Level Security",
    detail: "Enforced by Postgres, not by application code.",
  },
  {
    label: "Answer faithfulness",
    value: "100% RAGAS",
    detail: "Measured locally. The CI gate is 0.90, 0.85 and 0.80.",
  },
  {
    label: "Query latency",
    value: "p95 1900 ms",
    detail: "Single user, unthrottled, measured with Locust.",
  },
  {
    label: "Kill switch",
    value: "Under 5 seconds",
    detail: "Against a simulated runaway agent loop.",
  },
  {
    label: "Audit log",
    value: "Hash chained",
    detail: "Insert only. UPDATE and DELETE are blocked in the database.",
  },
  {
    label: "HIPAA Safe Harbor",
    value: "10 of 18",
    detail: "Identifiers detected. The gaps are named.",
  },
] as const;

const PILLARS = [
  {
    title: "Ask",
    text: "Hybrid search joins dense vectors with full text. Answers carry citation tags that are checked.",
  },
  {
    title: "Check",
    text: "A two layer prompt injection firewall and PII redaction cover text, image and PDF ingestion.",
  },
  {
    title: "Govern",
    text: "A hash chained audit log, a human review queue and an admin kill switch.",
  },
] as const;

type LandingProps = {
  message?: string;
  signInUrl: string;
};

function OutsideLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Landing({ message, signInUrl }: LandingProps) {
  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <p className="text-sm font-semibold tracking-tight">Fazle Enterprise AI Platform</p>
        <p
          className={`rounded-full border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700 ${mutedClass}`}
        >
          Local showcase
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-20 px-6 pt-10 pb-20">
        <section aria-labelledby="hero-heading" className="flex max-w-3xl flex-col gap-6">
          <h1
            id="hero-heading"
            className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
          >
            Enterprise RAG that is built to survive a security review
          </h1>
          <p className={`text-lg ${mutedClass}`}>
            A multi-tenant retrieval and agent platform with database enforced tenant isolation,
            cited answers, a kill switch and a governance layer. Every number below was measured on
            a local machine, and the evidence is in the repository.
          </p>
          {message ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <a href={signInUrl} className={primaryButtonClass}>
              Sign in with Keycloak
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              View source on GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </section>

        <section aria-labelledby="results-heading" className="flex flex-col gap-6">
          <h2 id="results-heading" className="text-2xl font-semibold tracking-tight">
            What has been measured
          </h2>
          <ul aria-label="Measured results" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MEASURED_RESULTS.map((item) => (
              <li
                key={item.label}
                className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"
              >
                <span className={`text-sm ${mutedClass}`}>{item.label}</span>
                <span className="font-mono text-xl font-semibold tracking-tight">{item.value}</span>
                <span className={`text-sm ${mutedClass}`}>{item.detail}</span>
              </li>
            ))}
          </ul>
          <p className={`text-sm ${mutedClass}`}>
            Single user latency, measured locally.{" "}
            <OutsideLink href={PROOF_URL}>See the evidence files</OutsideLink>
          </p>
        </section>

        <section aria-labelledby="pillars-heading" className="flex flex-col gap-6">
          <h2 id="pillars-heading" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex flex-col gap-2">
                <h3 className="text-lg font-medium">{pillar.title}</h3>
                <p className={`text-sm ${mutedClass}`}>{pillar.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer
        className={`mx-auto flex w-full max-w-5xl flex-col gap-3 border-t border-neutral-200 px-6 py-8 text-sm dark:border-neutral-800 ${mutedClass}`}
      >
        <p>Built by Fazle Rabbi. Nothing here is legal advice.</p>
        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
            {CONTACT_EMAIL}
          </a>
          <OutsideLink href={LINKEDIN_URL}>LinkedIn</OutsideLink>
          <OutsideLink href={REPO_URL}>Source code</OutsideLink>
        </p>
      </footer>
    </>
  );
}
