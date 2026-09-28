# @hrms/server

NestJS API. Architecture and module documentation live in [`/docs`](../../docs/README.md).

```bash
npm run start:dev          # watch mode (reads .env here or at the repo root)
npm run build && npm run start:prod
npm test                   # unit tests
npm run test:e2e           # API e2e (needs DATABASE_URL + Redis)
npx prisma migrate dev     # create a migration after editing prisma/schema.prisma
npx prisma migrate deploy  # apply migrations (production)
npm run create-super-admin # SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=…
```

Layout: `src/config` (validated env) · `src/common` (auth, guards, crypto, storage, email,
audit, filters) · `src/modules/<feature>` (controller, service, dto) · `prisma/` (schema,
migrations, seeds) · `test/` (e2e).
