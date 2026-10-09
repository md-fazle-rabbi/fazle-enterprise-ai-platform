"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

// Why: this page replaces the root layout, so it is the last resort and depends on nothing
// from the app: no Tailwind, no shared components, no imported stylesheet. The colours are
// the same neutral values the rest of the app uses. A style element is allowed by the
// style-src 'unsafe-inline' rule in proxy.ts.
const STYLES = `
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #ffffff; color: #171717; }
  main { box-sizing: border-box; min-height: 100vh; max-width: 48rem; margin: 0 auto; padding: 2rem; display: flex; flex-direction: column; justify-content: center; gap: 1.5rem; }
  h1 { margin: 0; font-size: 1.875rem; font-weight: 600; }
  p { margin: 0; color: #525252; }
  .reference { font-size: 0.875rem; }
  button { width: fit-content; border: 0; border-radius: 0.375rem; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; background: #171717; color: #ffffff; }
  button:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f5f5f5; }
    p { color: #d4d4d4; }
    button { background: #ffffff; color: #171717; }
    button:focus-visible { outline-color: #ffffff; }
  }
`;

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong</title>
        <style>{STYLES}</style>
        <main>
          <h1>Something went wrong</h1>
          <p role="alert">The application hit an unexpected error. You can try again.</p>
          {error.digest ? <p className="reference">{`Reference: ${error.digest}`}</p> : null}
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
