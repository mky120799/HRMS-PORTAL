# Hiring module

`apps/server/src/modules/hiring` · PostgreSQL · RabbitMQ · private object storage

## Purpose

The module covers the recruiting lifecycle from a public application through a tenant-configurable pipeline, interviews, collaborative feedback, external assessments, offer/hire decisions, an immutable timeline, and recruitment analytics. Assessment delivery and scoring stay with specialist providers; this application owns the integration boundary and normalized results.

## Architecture

| Component | Responsibility |
|---|---|
| `HiringService` | Jobs, careers page, application intake, authenticated resume streaming, compatibility status endpoint, AI rescreen requests |
| `HiringWorkflowService` | Ordered stages, transition permissions, rollback rules, timeline and stage audit records |
| `HiringInterviewService` | Atomic scheduling/rescheduling, persisted duration/location, calendar links and notification outbox entries |
| `HiringFeedbackService` | Transactional per-interviewer feedback and aggregate scores |
| `AssessmentIntegrationService` | Encrypted vendor configuration, assessment links, HMAC callbacks and callback idempotency |
| `HiringOutboxService` | Creates deterministic side-effect records in the business transaction |
| `HiringOutboxProcessor` | Leased, bounded-retry delivery to email, RabbitMQ and Slack |
| `HiringScheduler` | Lifecycle-aware, multi-instance-safe 24-hour reminder enqueueing |
| `HiringProcessor` | RabbitMQ consumer for advisory AI resume screening |

## Workflow rules

- Stages have a stable category (`APPLIED`, `SCREENING`, `INTERVIEW`, `OFFERED`, `HIRED`, or `REJECTED`) and a tenant-controlled order.
- Managers may move an application forward through active stages or reject it. They cannot move backward, issue an offer, or mark a candidate hired.
- Admins may issue offers and mark candidates hired. An admin backward move requires a non-empty `note`; the reason is stored in both `ApplicationEvent` and `AuditLog`.
- Moves use an optimistic update so competing requests cannot silently overwrite one another.
- Every required category must retain at least one active stage.
- Reordering accepts the complete stage-ID list and updates every position plus its audit record atomically.
- `PATCH /hiring/applications/:id` is retained for compatibility but uses exactly the same transition engine as the stage-specific move endpoint.

## Reliable side effects

Application intake, stage changes, interview scheduling/rescheduling, timeline entries, audit rows, and their `HiringOutboxEvent` records commit together. The outbox processor:

- claims records with a lease, including recovery of stale `PROCESSING` records;
- uses deterministic event keys and tenant-scoped uniqueness;
- retries with exponential backoff and stops after five attempts;
- records the terminal error on `FAILED` events;
- waits for RabbitMQ publisher confirms before completing an event.

Email creation is idempotent through `Notification(tenantId, idempotencyKey)`. Email workers also use a recoverable processing lease, preventing concurrent delivery while allowing a crashed worker's message to be retried. Slack hiring failures propagate to the outbox and are retried.

## Interview reminders

`HiringScheduler` starts and stops with the Nest module. Every hour it looks for interviews in the next 24 hours. Competing application instances atomically claim the schedule version before creating candidate/interviewer email outbox rows and an `INTERVIEW_REMINDER_QUEUED` event. A transaction failure rolls the claim back.

`interviewDurationMinutes`, `interviewLocation`, and `interviewScheduleVersion` are persisted. Rescheduling increments the version and clears `interviewReminderSentAt`, producing new deterministic reminder keys without duplicating the previous schedule's reminders. The field name is retained for compatibility, but its timestamp now means “reminder queued durably,” not “provider confirmed delivery.”

## API surface

All paths below are relative to `/api/v1`.

### Careers (public)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/careers/:slug` | Open jobs for the company slug; tenant IDs are not exposed |
| `POST` | `/careers/:slug/jobs/:jobId/apply` | Multipart name, email, consent, optional source, and PDF/DOCX resume |

### Jobs and stages (BASIC plan)

| Method | Path | Role |
|---|---|---|
| `GET` | `/hiring/jobs` | Admin, manager |
| `POST` | `/hiring/jobs` | Admin |
| `PATCH` | `/hiring/jobs/:id` | Admin |
| `GET` | `/hiring/stages` | Admin, manager |
| `POST` | `/hiring/stages` | Admin |
| `PATCH` | `/hiring/stages/:id` | Admin |
| `PUT` | `/hiring/stages/reorder` with `{ stageIds: string[] }` | Admin |

### Applications

| Method | Path | Notes |
|---|---|---|
| `GET` | `/hiring/applications` | Filters: `jobId`, `status`, `source`, pagination |
| `PATCH` | `/hiring/applications/:id` | Admin compatibility endpoint; shared transition rules |
| `POST` | `/hiring/applications/:id/move` | Manager/admin; rollback `note` required for admins |
| `GET` | `/hiring/applications/:id/timeline` | Immutable application history |
| `GET` | `/hiring/applications/:id/resume` | Authenticated private stream; never a public or signed URL |
| `POST` | `/hiring/applications/:id/schedule-interview` | Persists start, duration, location and schedule version |
| `POST` | `/hiring/applications/:id/rescreen` | Admin + ENTERPRISE; durable AI job publication |
| `GET/POST/DELETE` | `/hiring/applications/:id/feedback` | Read, upsert own, or delete own feedback |
| `GET/POST` | `/hiring/applications/:id/assessments` | List or link external assessment requests |

### Assessment integrations

| Method | Path | Notes |
|---|---|---|
| `GET/POST` | `/hiring/assessment-integrations` | Admin; secret returned only on creation |
| `POST` | `/hiring/assessment-integrations/:id/rotate-webhook-secret` | Admin; old secret stops working |
| `POST` | `/hiring/assessment-integrations/:id/webhook` | Public HMAC-SHA256 callback; provider event IDs are idempotent |

## Timeline and analytics

The timeline includes application submission, stage changes and rollbacks, interview scheduling/rescheduling and reminder enqueueing, feedback submission/update/deletion, assessment results, and AI screening completion/skip.

`GET /analytics/hiring` (BUSINESS plan) reports source of hire, time to hire, median time per stage, and offer acceptance. Stage durations begin at `APPLICATION_SUBMITTED` and use actual stage-entry events, including custom stages. Offer acceptance uses the cohort that entered `OFFERED`, so a later rejection remains in the denominator. Legacy applications without trustworthy submission/transition history remain in count metrics but are deliberately excluded from duration and offer-cohort calculations.

## Migration and backfill

Migration `20261005000000_hiring_full_hardening` adds the outbox, notification idempotency/lease fields, and persisted interview metadata. It creates missing canonical stages for every existing tenant and assigns a stage matching each legacy application's current status. It does **not** fabricate historical `ApplicationEvent` rows or timestamps.

## Frontend and optional integrations

- Hiring settings supports stage creation, activation, and atomic ordered-list reordering, plus assessment integration creation and secret rotation.
- Hiring screens support private resume download, interview scheduling/rescheduling, source and AI indicators, and structured feedback.
- Recruitment KPIs are shown in analytics.
- Job-board publishing/import and automatic video-meeting creation are optional future integrations. Location/video links remain user supplied today.

## Security and operations

- Every business query is tenant scoped; public careers lookup uses the tenant slug.
- Resume objects stay private and are streamed only after role and tenant authorization.
- Assessment webhook secrets are encrypted at rest and callbacks use exact raw-body HMAC verification.
- AI scores are advisory and never auto-reject a candidate.
- Monitor `HiringOutboxEvent.status = 'FAILED'`, RabbitMQ queue depth, retry queues, dead-letter queues, connection health, and oldest pending outbox age. Alert on any failed event or sustained pending age.
