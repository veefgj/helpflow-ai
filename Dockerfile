# ADR-002: API and worker are built from this one shared image on Railway (two services, same
# image, selected at runtime by $SERVICE). Workspace packages (@helpflow/config, @helpflow/types,
# @helpflow/database, ...) ship as raw .ts with no build step, so esbuild bundles each app's own
# code together with every @helpflow/* package it imports into a single dist/main.js, while real
# npm dependencies stay external and are installed normally into node_modules (see
# scripts/bundle-app.mjs for exactly what's bundled vs. left external).
FROM node:24-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# `prisma generate` only needs DATABASE_URL to satisfy prisma.config.ts's schema — it never
# connects to it at generate time, so a placeholder is fine at build time.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN pnpm --filter @helpflow/database run generate
RUN pnpm --filter @helpflow/api run bundle
RUN pnpm --filter @helpflow/worker run bundle

# Separate stage (not a --prod re-install over the dev-mode node_modules above, which pnpm treats
# as "remove and reinstall from scratch" and silently mishandles in a non-interactive build): a
# clean install of only production dependencies, for the runtime image's node_modules.
FROM node:24-slim AS prod-deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --prod --frozen-lockfile

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN useradd --system --create-home helpflow
# pnpm's workspace layout keeps the content-addressable store at the repo root (node_modules/.pnpm)
# but each app's own direct dependencies are relative symlinks under that app's own node_modules
# (apps/api/node_modules/reflect-metadata -> ../../../node_modules/.pnpm/...) — Node's resolution
# starts at dist/main.js's own directory and walks upward, so both directories must be present with
# their relative paths intact for those symlinks to resolve.
COPY --from=prod-deps --chown=helpflow:helpflow /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=helpflow:helpflow /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps --chown=helpflow:helpflow /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder --chown=helpflow:helpflow /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=helpflow:helpflow /repo/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=helpflow:helpflow /repo/package.json ./package.json
USER helpflow

# SERVICE selects which process this container runs: "api" (default, HTTP + Socket.IO on $PORT)
# or "worker" (BullMQ queue consumers, no HTTP server). Railway sets this per-service via env.
ENV SERVICE=api
EXPOSE 4000
CMD ["sh", "-c", "node --env-file-if-exists=.env apps/${SERVICE}/dist/main.js"]
