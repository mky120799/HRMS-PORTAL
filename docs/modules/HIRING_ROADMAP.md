# Hiring module roadmap

Status as of **2026-10-02**. See [`hiring.md`](hiring.md) for current behavior and API contracts.

## Completed

### H1 — Collaborative interview feedback

- One structured feedback record per reviewer/application, with rating, recommendation, notes and aggregates.
- Transactional submit, update and delete operations with timeline and audit entries.
- Candidate feedback UI for managers and admins.

### H2 — Recruitment analytics

- Source-of-hire counts and hiring results.
- Average/median time to hire from the first real `HIRED` entry.
- Median duration per custom stage from actual entry events, beginning at `APPLICATION_SUBMITTED`.
- Offer acceptance based on the historical offered cohort, including later rejections.
- Legacy records without reliable event history remain in counts but not historical-duration metrics.

### H3 — Interview scheduling and reminders

- Scheduling/rescheduling with persisted duration, location and version.
- Lifecycle-aware reminder scheduler with multi-instance atomic claims.
- Candidate/interviewer reminder outbox records and deterministic schedule-version keys.
- Timer cleanup on module shutdown.

### H4 — Pipeline and integration settings UI

- Assessment integration creation and webhook-secret rotation.
- Pipeline stage creation and activation controls.
- Atomic `PUT /hiring/stages/reorder` using the complete ordered stage-ID list.
- Recruitment KPI cards and charts.

### H5 — Workflow and delivery hardening

- Manager forward/reject permissions; admin-only offer/hire; reason-required admin rollback.
- Optimistic concurrency for application moves and interview schedules.
- Protection against deactivating the last active stage in a required category.
- Transactional application events, audit data and durable side effects.
- Leased hiring outbox with bounded retry, failure state and RabbitMQ publisher confirms.
- Tenant-scoped email idempotency and recoverable email delivery claims.
- Shared notification events/outbox for candidate email and interviewer email/in-app delivery, with user preference enforcement.
- Feedback deletion and AI screening completion/skip timeline events.
- Existing-tenant default stages and current-stage backfill without synthetic history.
- PostgreSQL/RabbitMQ CI services, unit reliability coverage, and hiring E2E coverage.

## Optional future integrations

### Job boards

Not started. A future implementation would need per-provider job publishing/closure adapters, signed inbound application callbacks, credential rotation, mapping/reconciliation, and source attribution.

### Video interview providers

Not started. A future implementation would create and cancel meetings through Zoom, Google Meet, or Teams, securely store tenant OAuth grants, and reconcile provider changes. The current scheduling API accepts a room or video URL in `location`.

### Provider-specific assessment adapters

The vendor-neutral request/webhook boundary is complete. Provider-specific outbound APIs, catalog synchronization, candidate invitations, and richer result normalization remain optional adapters rather than an in-house assessment engine.
