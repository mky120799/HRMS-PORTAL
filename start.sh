#!/bin/bash

# HRMS Portal Startup Script
# This script ensures databases are up, project is bootstrapped, and all services are started.

# 1. Start Infrastructure
echo "🚀 Starting infrastructure (Postgres & MongoDB)..."
docker-compose up -d

if [ $? -ne 0 ]; then
    echo "❌ Error: Docker Compose failed to start. Ensure Docker is running."
    exit 1
fi

# 2. Ensure Dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules not found. Installing dependencies..."
    npm install
fi

# 3. Wait for DBs
echo "⏳ Waiting for databases to initialize..."
sleep 3

# 4. Bootstrap (Build shared + Prisma generate)
echo "🛠️ Bootstrapping project (shared packages & prisma clients)..."
npm run bootstrap

if [ $? -ne 0 ]; then
    echo "❌ Error: Bootstrap failed. Please check the logs above."
    exit 1
fi

# 4. Run all services
echo "✨ Starting HRMS Portal (Microservices + Frontend)..."
echo "💡 Tip: All services run concurrently. Check the prefixed logs."
npm run dev
