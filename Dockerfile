# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: @node-rs/argon2 ships a glibc prebuild, and
# musl would force a source build for no benefit here.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# The ops scripts as plain JavaScript. The runtime has no tsx, and without
# these the deployed app could create its two accounts and nothing else — no
# seeding the deck, no generating audio onto the media volume, which is a job
# that can only run where that volume is.
RUN pnpm ops:build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone output carries only the server and the modules it actually uses.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations run from src/instrumentation.ts on server start, so the image
# needs the SQL files. scripts/ carries seed-users.mjs and the dist/ scripts
# compiled above; seed/ is the deck and curriculum they import.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/seed ./seed
# Two things the standalone tree gets wrong, both about resolution rather than
# missing files.
#
# `postgres` is only linked at the top level for packages the server imports by
# name, and the one-off seeding script needs it too.
#
# argon2's platform binary is copied in by outputFileTracingIncludes but
# without the symlink that makes it findable: the wrapper requires
# `@node-rs/argon2-linux-<arch>-gnu` from its own node_modules, and a bare
# directory in .pnpm is not that. Relinked here from whatever the install
# produced, so this is correct on x64 and arm64 alike.
RUN set -eu; \
    cd /app/node_modules; \
    ln -sfn "$(ls -d .pnpm/postgres@*/node_modules/postgres | head -n1)" postgres; \
    wrapper="$(ls -d /app/node_modules/.pnpm/@node-rs+argon2@*/node_modules/@node-rs)"; \
    for binding in /app/node_modules/.pnpm/@node-rs+argon2-*/node_modules/@node-rs/*; do \
      ln -sfn "$binding" "$wrapper/$(basename "$binding")"; \
    done; \
    node -e "import('@node-rs/argon2').then(m=>m.hash('x')).then(()=>console.log('argon2 binding ok'))"; \
    mkdir -p /media && chown -R nextjs:nodejs /media

USER nextjs
EXPOSE 3000
ENV MEDIA_ROOT=/media
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
