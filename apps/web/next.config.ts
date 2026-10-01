import path from "node:path";
import type { NextConfig } from "next";

// Why: cheap browser-side protections that need no code. nosniff stops MIME guessing,
// DENY stops other sites from framing this app (clickjacking), the rest limits what the
// browser leaks or allows. The Content-Security-Policy is not here because it needs a
// fresh nonce per request, so it is set in src/proxy.ts instead.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Why: two lockfiles exist (repo root and apps/web), so Next.js was guessing the workspace
// root. Pinning it to the repo root silences the warning and keeps standalone file tracing
// deterministic. It is the same root Next already inferred, so the standalone output stays
// at .next/standalone/apps/web/server.js.
const workspaceRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  // Why: builds a minimal, self-contained server (.next/standalone) that traces only the
  // files each route actually needs. Deferred from the scaffold because
  // `next start` warns when this is on without a matching Docker setup; that setup is this
  // step.
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
