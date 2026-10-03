# Build context is the repository root.
# docker-compose.yml and CI both use context: .

FROM node:24-slim AS deps
WORKDIR /app/apps/web

# Why: package.json and package-lock.json copied alone, so this layer only invalidates
# when the web dependency graph actually changes, not on every source edit.
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app

# Preserve the monorepo filesystem layout because next.config.ts sets
# outputFileTracingRoot to the repository root.
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web

WORKDIR /app/apps/web

# Why: env.ts reads process.env the moment it is imported, and `next build`
# imports every route to bundle and type-check it, even routes that are dynamic at request
# time. KEYCLOAK_WEB_CLIENT_SECRET is the one setting with no default, deliberately,
# so a missing secret fails loudly rather than falling back to something guessable.
#
# The placeholder is scoped to this command so it does not become a persistent image
# environment variable. The real value is supplied when the container starts.
RUN KEYCLOAK_WEB_CLIENT_SECRET=build-time-placeholder-not-used-at-runtime npm run build

FROM node:24-slim AS runtime

# Why: patches OS CVEs Debian has already fixed upstream. The base tag only
# rebuilds on release, not on every security update, so this closes security
# fixes available in the current Debian package repositories.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get upgrade -y

# Why: the runtime only executes `node server.js` and the HEALTHCHECK's `node -e`.
# npm, npx, corepack and yarn are build-time tools. Removing them reduces the
# runtime attack surface and avoids shipping unnecessary package-manager code.
# Must run before `USER node`, while still root.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /opt/yarn-v1.22.22

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Why: with outputFileTracingRoot set to the repository root, Next.js standalone
# preserves the monorepo-relative path.
#
# The generated structure is:
#
# .next/standalone/
# ├── node_modules/
# └── apps/
#     └── web/
#         └── server.js
#
# Copy the complete standalone tree into the same repository-root layout.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./

# Next.js standalone does not copy public/ automatically.
# Keep it at the application's original monorepo path.
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

# Next.js standalone also does not copy .next/static automatically.
# Create the runtime .next directory with the correct ownership first.
RUN mkdir -p apps/web/.next \
    && chown -R node:node apps/web/.next

COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

# server.js now exists at:
# /app/apps/web/server.js
WORKDIR /app/apps/web

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]