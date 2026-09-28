# Build context: repository root.  docker build -f apps/server/Dockerfile .

# ── Stage 1: compile ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
RUN npm ci --workspace @hrms/server --include-workspace-root --ignore-scripts
COPY apps/server apps/server
WORKDIR /app/apps/server
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

# ── Stage 2: runtime (production dependencies only, non-root) ────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
RUN npm ci --omit=dev --workspace @hrms/server --ignore-scripts && npm cache clean --force
COPY apps/server/prisma apps/server/prisma
COPY apps/server/prisma.config.ts apps/server/
RUN cd apps/server && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY --from=builder /app/apps/server/dist apps/server/dist

USER node
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
# tini forwards SIGTERM so Nest can drain requests and queue workers on shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations run as a separate one-off command: npx prisma migrate deploy
CMD ["node", "dist/main"]
