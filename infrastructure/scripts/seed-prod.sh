#!/bin/bash
set -e

echo "========================================="
echo "Starting Production Database Preparation"
echo "========================================="

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

echo "1. Pushing Prisma schema to PostgreSQL RDS..."
# db push is used here because it automatically handles schema sync 
# without needing shadow databases, which can be problematic in locked-down RDS instances.
# Alternatively, deploy migrate could be used if migrations are committed.
npx prisma db push --accept-data-loss

echo "2. Applying database seed data (if necessary)..."
# You can uncomment the following line if you want the seed script to run on deploy:
# npx prisma db seed

echo "========================================="
echo "Database Preparation Complete"
echo "========================================="
