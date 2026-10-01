import type { NextConfig } from "next";

// Why: cheap browser-side protections that need no code. nosniff stops MIME guessing,
// DENY stops other sites from framing this app (clickjacking), the rest limits what the
// browser leaks or allows. A Content-Security-Policy needs per-request nonces and comes later.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Why: builds a minimal, self-contained server (.next/standalone) that traces only the
  // files each route actually needs. Deferred from the scaffold because
  // `next start` warns when this is on without a matching Docker setup; that setup is this
  // step.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
