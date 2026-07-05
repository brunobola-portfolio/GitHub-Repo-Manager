# Stage 1: Build frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app

# Install only production deps + build tools for better-sqlite3
RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && apk del .build-deps

# Copy built frontend + server
COPY --from=builder /app/dist ./dist
COPY server ./server

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
