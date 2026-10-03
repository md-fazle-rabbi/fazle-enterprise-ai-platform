# Build context is apps/web, docker-compose.yml sets context: ./apps/web

FROM node:24-slim AS deps
WORKDIR /app

# Why: package.json and package-lock.json copied alone, so this layer only invalidates
# when a dependency actually changes, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Why: env.ts reads process.env the moment it is imported, and `next build`
# imports every route to bundle and type-check it, even routes that are dynamic at request
# time. KEYCLOAK_WEB_CLIENT_SECRET is the one setting with no default (deliberately, so a
# missing secret fails loudly rather than falling back to something guessable), so the build
# needs a placeholder to get past that check. It is set inline on this one command instead
# of with ENV, so it never lands in image metadata. The real secret is supplied at container
# start, the same way docker-compose.yml already supplies every other setting in env.ts.
RUN KEYCLOAK_WEB_CLIENT_SECRET=build-time-placeholder-not-used-at-runtime npm run build

FROM node:24-slim AS runtime

# Why: patches OS CVEs Debian has already fixed upstream, the same reasoning and cache
# mount shape as packages/rag-engine/Dockerfile, kept ahead of the COPY steps so it stays
# cache-stable across source edits rather than re-running apt over the network every build.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get upgrade -y

# Why: the runtime only executes `node server.js` (and the HEALTHCHECK's `node -e`);
# npm, npx, corepack and yarn are build-time tools. Removing them reduces the attack
# surface and avoids shipping unnecessary package dependencies.
# Must run before `USER node`, while still root.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v1.22.22

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Why: Next.js standalone output preserves the monorepo path when
# outputFileTracingRoot points to the repository root.
# The server therefore exists at:
# /app/apps/web/server.js
#
# Copy the complete standalone output first.
COPY --from=builder --chown=node:node /app/.next/standalone ./

# Runtime assets need to live beside the web application.
COPY --from=builder --chown=node:node /app/public ./apps/web/public

RUN mkdir -p apps/web/.next && chown -R node:node apps/web/.next

COPY --from=builder --chown=node:node /app/.next/static ./apps/web/.next/static

# Run from the directory containing server.js.
WORKDIR /app/apps/web

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]