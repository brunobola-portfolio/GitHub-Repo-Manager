# Stage 1: Build frontend
FROM node:24-alpine AS builder
WORKDIR /app
# better-sqlite3 13 ships musl prebuilds (prebuilds/linuxmusl-x64.node), so the
# common path no longer compiles. The toolchain stays as a fallback: a future
# dependency, or an architecture without a prebuild, would otherwise fail the
# build stage with a node-gyp error instead of downloading a binary.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:24-alpine AS production
WORKDIR /app

# Install only production deps + build tools for better-sqlite3
RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && apk del .build-deps

# Copy built frontend + server
COPY --from=builder /app/dist ./dist
COPY server ./server
# Offline JWT license verification needs the Ed25519 public key at runtime.
# Without it require-tier.js/license.js resolve PUBLIC_KEY=null and every
# self-hosted LICENSE_KEY silently degrades to the Free tier. Public key only —
# keys/private.pem stays gitignored + .dockerignored.
COPY keys/public.pem ./keys/public.pem
# Apache-2.0 §4(a)/§4(d) — the image is a distribution, so it carries the terms.
COPY LICENSE NOTICE TRADEMARKS.md ./

# Create data directory
RUN mkdir -p server/data && chown -R node:node server/data

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Non-root user
USER node

EXPOSE 3001

# Health check — use Node's built-in http module so we don't depend on
# wget/curl being in the base image. Exits 0 on 2xx, non-zero otherwise.
# Targets the purpose-built liveness probe (routes/health.js), which is mounted
# BEFORE the rate limiters/session and reports 503 while shutting down — unlike
# the legacy /api/health handler which sits behind the shared rate-limit bucket.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/api/health/live', r => process.exit(r.statusCode >= 200 && r.statusCode < 300 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
