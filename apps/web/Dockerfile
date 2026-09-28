# Build context: repository root.  docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
RUN npm ci --workspace @hrms/web --include-workspace-root --ignore-scripts
COPY apps/web apps/web
# Same-origin API behind the reverse proxy; override for split-domain deployments.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w @hrms/web

# Unprivileged nginx listens on 8080 and runs as a non-root user.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infrastructure/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/snippets/ /etc/nginx/snippets/
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
