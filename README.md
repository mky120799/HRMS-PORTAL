# HRMS — multi-tenant HR platform

Employees · leave · attendance · payroll & payslips · documents · performance reviews ·
hiring with a public careers page · Stripe billing · optional AI screening.

**Stack:** NestJS 11 (Fastify) · PostgreSQL + Prisma · Redis + BullMQ · React 18 + React Query ·
AWS ECS Fargate, RDS, ElastiCache, S3, SES, WAF · Terraform · GitHub Actions.

## Quick start (local)

Requirements: Node 22+, Docker.

```bash
./start.sh
```

This starts Postgres and Redis, applies migrations, seeds a workspace and runs both apps:

* Web: http://localhost:5173 — sign in with workspace `acme`, `admin@acme.test`, `ChangeMe-12345`
  (or create a new workspace at `/signup` and choose "Load sample data").
* API docs: http://localhost:3000/api/docs
* Emails are printed in the API log (`EMAIL_DRIVER=log`).

Manual steps if you prefer: `docker compose up -d`, copy `.env.example` to `.env`,
`npm install`, `npm run db:deploy`, `npm run db:seed`, `npm run dev`.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (watch) + web (Vite) |
| `npm run typecheck` | Type-check server and web |
| `npm test` | Unit tests |
| `npm run test:e2e:api` | API integration/security tests (needs Postgres + Redis) |
| `npm run test:e2e:ui` | Playwright browser tests (after `npm run build`) |
| `npm run db:migrate` | Create a new migration from `schema.prisma` changes (dev) |
| `npm run db:deploy` | Apply migrations |
| `npm run build` | Production builds |

## Repository layout

```
apps/server    NestJS API (+ prisma/ schema & migrations, test/ e2e)
apps/web       React SPA
apps/e2e       Playwright smoke tests
infrastructure terraform/ (AWS), nginx/, scripts/deploy.sh
docs/          architecture, security, deployment, testing, per-module docs
```

## Documentation

Start at [docs/README.md](docs/README.md). Deploying: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
Security: [docs/SECURITY.md](docs/SECURITY.md).
