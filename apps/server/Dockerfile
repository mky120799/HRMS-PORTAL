# Context for this Dockerfile should be the MONOREPO ROOT

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root configurations
COPY package*.json ./

# Copy workspace package.json files
COPY packages/shared/package*.json ./packages/shared/
COPY apps/server/package*.json ./apps/server/

# Install all dependencies (development + production)
RUN npm ci

# Copy the actual source code
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/

# Build Shared Package
RUN npm run build -w @hrms/shared

# Generate Prisma Client
RUN npm run prisma:generate -w @hrms/server

# Build the NestJS Server
RUN npm run build -w @hrms/server

# Stage 2: Production (Minimal Image)
FROM node:20-alpine AS production

WORKDIR /app

# Copy root configuration
COPY package*.json ./

# Copy built shared package
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy built server package and Prisma schema
COPY --from=builder /app/apps/server/package*.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/node_modules/.prisma ./apps/server/node_modules/.prisma
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma

# Install ONLY production dependencies (keeps image lightweight and secure)
RUN npm ci --omit=dev

# Set Environment to Production
ENV NODE_ENV=production

EXPOSE 3000

# Start command mapped to the workspace
CMD ["npm", "run", "start:prod", "-w", "@hrms/server"]
