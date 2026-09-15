# syntax=docker/dockerfile:1

# Multi-platform index verified for linux/arm64 and linux/amd64.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Standalone tracing does not include public or static assets.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Amazon's RDS certificate bundle, so DATABASE_URL can say
# `sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` and the
# database connection is verified, not merely encrypted. Harmless elsewhere.
COPY --chown=node:node deploy/aws/rds-global-bundle.pem ./certs/rds-global-bundle.pem

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health', { signal: AbortSignal.timeout(4000) }).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "server.js"]
