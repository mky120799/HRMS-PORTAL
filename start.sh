#!/usr/bin/env bash
# One-command local setup: dependencies, database, migrations, seed, dev servers.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example"; }

echo "▶ Starting Postgres and Redis…"
docker compose up -d --wait

[ -d node_modules ] || npm install

echo "▶ Applying database migrations…"
npm run db:deploy

echo "▶ Seeding development data (workspace: acme)…"
npm run db:seed || true

echo "▶ Starting API (http://localhost:3000/api/docs) and web (http://localhost:5173)…"
npm run dev
