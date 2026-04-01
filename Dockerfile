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
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

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

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
