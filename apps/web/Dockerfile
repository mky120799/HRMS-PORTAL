# Stage 1: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root configurations
COPY package*.json ./

# Copy workspace package.json files
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

# Install dependencies
RUN npm ci

# Copy the source code
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

# Build Shared Package
RUN npm run build -w @hrms/shared

# Build the Web Application
# Vite uses VITE_API_URL during build/runtime
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build -w @hrms/web

# Stage 2: Serve the application using Nginx
FROM nginx:alpine AS production

# Copy custom nginx configuration
# We assume nginx.conf is mapped or built in from infrastructure/nginx/nginx.conf
COPY infrastructure/nginx/nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
