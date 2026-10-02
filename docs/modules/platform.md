# Platform operations (SUPER_ADMIN) & health

## Platform — `apps/server/src/modules/platform`
Operators sign in to a dedicated `platform` workspace (created with
`npm run create-super-admin -w @hrms/server`). They never belong to a customer tenant.

| Method & path | Notes |
| --- | --- |
| `GET /platform/tenants?search&page` | name, slug, plan/status, users/employees counts — **no employee personal data** |
| `PATCH /platform/tenants/:id` `{ isActive }` | suspend / reactivate; takes effect within the 30 s tenant cache; audited |

`SUPER_ADMIN` has no implicit bypass of tenant rules — least privilege for operators too.

## Health — `apps/server/src/modules/health`

| Endpoint | Purpose | Used by |
| --- | --- | --- |
| `GET /health` | process is alive | container health check |
| `GET /health/ready` | DB `SELECT 1` and RabbitMQ queue checks within 2 s each, else 503 | ALB target group — traffic only goes to instances that can serve it |
| `GET /health/queues` | RabbitMQ publishing/queue availability and dead-letter queue names to alert on | Production monitor |

Both are public and exempt from rate limiting and request logging.
