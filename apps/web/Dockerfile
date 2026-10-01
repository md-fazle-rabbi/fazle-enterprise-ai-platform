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
# Why: env.ts (micro-step 7) reads process.env the moment it is imported, and `next build`
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

WORKDIR /app
ENV NODE_ENV=production
# Why: the standalone server binds to this address, not to the loopback interface. Left at
# its default, Docker's port mapping would have nothing to reach inside the container.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Why: the standalone build traces only the files each route actually needs, but it does
# not copy public/ or .next/static itself, both are copied here by hand, and the prerender
# cache directory (.next) is pre-created with the right owner since nothing else creates it.
# The built-in `node` user (uid/gid 1000) from the base image is the non-root user, so no
# separate user is created.
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir .next && chown node:node .next
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]