# Deployment & operations

Two supported targets:

| | **AWS (recommended)** | **Single host** |
| --- | --- | --- |
| Files | `infrastructure/terraform`, `infrastructure/scripts/deploy.sh`, CI | `docker-compose.prod.yml` |
| Availability | Multi-AZ DB, ≥ 2 API tasks, autoscaling, rolling deploys | One VM — downtime during host maintenance |
| Backups | RDS PITR 14 days + final snapshot | You must schedule `pg_dump` (below) |
| Good for | Paying customers, growth | Pilots, a single small customer |

## AWS

### One-time setup
1. **State backend**: create an S3 bucket (versioned, encrypted) and a DynamoDB table
   (`LockID` string key). Copy `backend.hcl.example` → `backend.hcl`.
2. **Certificate**: request an ACM certificate for your domain in the target region and validate it.
3. **Variables**: copy `terraform.tfvars.example` → `terraform.tfvars`.
4. Apply:
   ```bash
   cd infrastructure/terraform
   terraform init -backend-config=backend.hcl
   terraform plan -out plan.tfplan && terraform apply plan.tfplan
   ```
5. **DNS**: point your domain at `alb_dns_name`; add the `ses_dkim_tokens` CNAMEs; request SES
   production access (sandbox only sends to verified addresses).
6. **Integrations secret**: fill `integrations_secret_arn` (Stripe, Gemini, Google, Sentry) in the
   Secrets Manager console. Empty values simply disable a feature.
7. **First image**: CI's first deploy pushes images and registers task definitions. The ECS
   services start once an image exists.
8. **Operator account**: run the super-admin script once (ECS Exec or a one-off task):
   `SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… npm run create-super-admin -w @hrms/server`.
9. **GitHub**: create an OIDC deploy role (trust `token.actions.githubusercontent.com`, repo +
   `environment:production`), store its ARN as secret `AWS_DEPLOY_ROLE_ARN`, set variable
   `AWS_REGION`, and add required reviewers to the `production` environment.

### Release flow
Push to `main` → CI runs typecheck, unit, API e2e (real Postgres/Redis), browser e2e, image build
and Trivy scan → a reviewer approves the `production` environment → `deploy.sh`:

1. registers new task-definition revisions for the commit's image tag;
2. runs `prisma migrate deploy` as a one-off task — **if it fails, nothing is rolled out**;
3. updates the services; ECS starts new tasks, waits for `/health/ready`, then drains old ones
   (30 s). The deployment circuit breaker rolls back automatically if new tasks fail.

Migrations must be **backward compatible** with the running version (expand → migrate → contract),
because old and new tasks overlap during a rollout.

### Rollback
* **Application:** redeploy the previous commit's image: `IMAGE_TAG=<previous-sha> ./infrastructure/scripts/deploy.sh`
  (images are immutable and ECR keeps the last 30).
* **Database:** migrations are forward-only. For a bad data change, restore to a point in time
  (RDS console → *Restore to point in time*) into a new instance, verify, then switch
  `DATABASE_URL` in the app secret.

### Routine operations
| Task | How |
| --- | --- |
| Rotate `JWT_SECRET` | Update the app secret, redeploy. All users sign in again. |
| Rotate `ENCRYPTION_KEY` | **Do not change in place** — encrypted fields would become unreadable. Add a v2 key and re-encrypt (the ciphertext format is versioned `v1.` for this reason). |
| Rotate DB password | `terraform apply -replace=random_password.db`, then redeploy. |
| Scale | Autoscaling targets 60 % CPU (2–10 tasks). Adjust in `ecs.tf`. |
| Logs | CloudWatch `/ecs/hrms-production/server`; search by `reqId=` from a user's error message. |
| Suspend a customer | Platform console → Suspend (effective within 30 s). |

## Single host (docker compose)
```bash
cp .env.production.example .env.production   # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
* Caddy obtains TLS certificates automatically for `DOMAIN` (ports 80/443 must be open).
* `migrate` runs before `server` starts on every `up`.
* Files still go to S3 (a container disk is not durable storage).
* **Backups** (cron, daily, keep 14 days, copy off-host):
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U hrms -Fc hrms > backup-$(date +%F).dump
  # restore: docker compose ... exec -T postgres pg_restore -U hrms -d hrms --clean < backup.dump
  ```
  Test a restore at least once before relying on it.

## Configuration reference
Validated at boot by `apps/server/src/config/env.ts`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | add `sslmode=require` in production |
| `RABBITMQ_URL` | AMQP connection URL required | |
| `JWT_SECRET` | yes, ≥ 32 chars | root for all token keys |
| `ENCRYPTION_KEY` | yes, 32 bytes base64 | back it up; losing it loses 2FA secrets/webhooks |
| `FRONTEND_URL`, `CORS_ORIGINS` | yes (https in prod) | links in emails, CORS allow-list |
| `TRUST_PROXY` | `true` behind ALB/nginx | makes client IPs correct |
| `STORAGE_DRIVER=s3`, `AWS_S3_BUCKET_NAME`, `AWS_REGION` | prod | |
| `EMAIL_DRIVER=ses`, `EMAIL_FROM` | prod | SES-verified domain |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | optional | AI features |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | optional | SSO |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | optional | billing |
| `SENTRY_DSN` | optional | error tracking |
| `ENABLE_SWAGGER` | optional | defaults off in production |
