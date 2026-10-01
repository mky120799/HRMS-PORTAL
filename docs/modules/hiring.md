# Hiring module

`apps/server/src/modules/hiring` · uses `ai`, `integrations/slack`, `common/storage`,
`common/email`, `common/messaging` (RabbitMQ)

## Purpose

End-to-end recruiting: public careers page → candidate application → configurable pipeline
stages → AI resume screening → interview scheduling → assessment integrations → audit trail.

---

## Data model

```
Job(tenantId, title, description, department, location, status OPEN|CLOSED)
  └── Application(tenantId, jobId, stageId, candidateName, candidateEmail,
                  resumeKey, resumeMimeType, resumeFilename,
                  status, aiScore, aiReason, aiScoredAt,
                  interviewAt, interviewerEmail)
        unique (jobId, candidateEmail)
        └── ApplicationEvent(type, note, metadata, actorUserId)   — immutable timeline
        └── AssessmentRequest(integrationId, externalId, status, score, recommendation, reportUrl)
              └── AssessmentWebhookEvent(providerEventId)         — idempotency fence

HiringStage(tenantId, key, category, name, position, isActive)
  @@unique [tenantId, key]

AssessmentIntegration(tenantId, provider, displayName, webhookSecretEnc, config, isActive)
  @@unique [tenantId, provider]
```

Pipeline categories (fixed): `APPLIED → SCREENING → INTERVIEW → OFFERED → HIRED`
(or `REJECTED` at any step). Tenants can add custom named stages within each category.

---

## Endpoints

### Public (no auth)

| Method & path | Rate limit | Notes |
|---|---|---|
| `GET /careers/:slug` | — | Company name + open jobs. **No tenant ids** in response |
| `POST /careers/:slug/jobs/:jobId/apply` | 5 req / 10 min / IP | multipart: `candidateName`, `candidateEmail`, `consent=true`, `resume` (PDF/DOCX ≤ 5 MB) |

### Authenticated (BASIC plan, ADMIN or MANAGER)

| Method & path | Role | Notes |
|---|---|---|
| `GET /hiring/jobs` | MANAGER+ | Includes `_count.applications` |
| `POST /hiring/jobs` | ADMIN | Creates job, publishes to careers page |
| `PATCH /hiring/jobs/:id` | ADMIN | Edit fields or open/close |
| `GET /hiring/stages` | MANAGER+ | Tenant pipeline stages, auto-seeds defaults |
| `POST /hiring/stages` | ADMIN | Add custom stage within a category |
| `PATCH /hiring/stages/:id` | ADMIN | Rename, reorder, activate/deactivate |
| `GET /hiring/applications?jobId&status&page` | MANAGER+ | Paginated, filterable |
| `GET /hiring/applications/:id/resume` | MANAGER+ | Streamed from private storage |
| `GET /hiring/applications/:id/timeline` | MANAGER+ | Immutable event log |
| `POST /hiring/applications/:id/move` | MANAGER+ | Move to stage; `{stageId, note?}` |
| `PATCH /hiring/applications/:id` | ADMIN | Fast status jump; emails candidate |
| `POST /hiring/applications/:id/schedule-interview` | MANAGER+ | Emails invite + calendar link |
| `POST /hiring/applications/:id/rescreen` | ADMIN (ENTERPRISE) | Re-queue AI screening |
| `GET /hiring/assessment-integrations` | ADMIN | List vendor integrations |
| `POST /hiring/assessment-integrations` | ADMIN | Create integration; returns one-time webhook secret |
| `POST /hiring/assessment-integrations/:id/rotate-webhook-secret` | ADMIN | Rotate HMAC secret |
| `GET /hiring/applications/:id/assessments` | MANAGER+ | List assessment requests |
| `POST /hiring/applications/:id/assessments` | MANAGER+ | Link a vendor assessment |

### Vendor webhook (no auth — signature verified)

| Method & path | Notes |
|---|---|
| `POST /hiring/assessment-integrations/:id/webhook` | HMAC-SHA256 over raw body; idempotent via `AssessmentWebhookEvent` |

---

## Flow

```mermaid
sequenceDiagram
  participant C as Candidate
  participant API
  participant S3
  participant Q as hiring queue
  participant AI as Gemini

  C->>API: POST /careers/:slug/jobs/:jobId/apply (multipart)
  API->>API: validate job belongs to slug, is OPEN; magic-byte MIME check
  API->>S3: put tenants/<id>/resumes/<job>/<uuid>.pdf
  API->>API: create Application (unique job+email guard → 409 on dup)
  API-->>C: 201 + confirmation email + Slack alert to recruiter
  API->>Q: publish screen {applicationId, tenantId} if AI enabled + ENTERPRISE plan

  Q->>S3: fetch resume buffer
  Q->>AI: extractText → screenResume(job, text)
  AI-->>Q: {score 0-100, summary, strengths[], gaps[]}
  Q->>API: update Application.aiScore / aiReason (advisory only)
```

**Interview scheduling:**
1. Validates interviewer is an active workspace user.
2. Rejects past-dated start times.
3. Auto-moves application to `INTERVIEW` category if not already there.
4. Stores `interviewAt`, `interviewerEmail` on Application.
5. Creates `INTERVIEW_SCHEDULED` ApplicationEvent with full metadata.
6. Emails both candidate and interviewer with an "Add to Google Calendar" deep-link.
   No shared Google account or OAuth token is involved.

---

## Configurable pipeline (HiringWorkflowService)

Default stages seeded per tenant on first access (idempotent `createMany skipDuplicates`):

| key | name | category | position |
|---|---|---|---|
| APPLIED | Applied | APPLIED | 10 |
| SCREENING | Screening | SCREENING | 20 |
| INTERVIEW | Interview | INTERVIEW | 30 |
| OFFERED | Offer | OFFERED | 40 |
| HIRED | Hired | HIRED | 50 |
| REJECTED | Rejected | REJECTED | 60 |

Tenants can add stages (e.g. `TECHNICAL_INTERVIEW` within `INTERVIEW`) and reorder by
`position`. Allowed category transitions are enforced server-side:

```
APPLIED     → SCREENING, INTERVIEW, REJECTED
SCREENING   → INTERVIEW, REJECTED
INTERVIEW   → OFFERED, REJECTED
OFFERED     → HIRED, REJECTED
HIRED       → (terminal)
REJECTED    → (terminal)
```

Stage moves use an optimistic-concurrency `updateMany` (checks current `status + stageId`)
inside a transaction to prevent races.

---

## AI screening (HiringProcessor)

* Runs off the request path via RabbitMQ (`HIRING_QUEUE`), concurrency 2, 3 retries, 60 s backoff.
* Fetches resume from S3, extracts text via `AiService.extractText`.
* If text < 100 chars → marks `aiReason` as "could not be read" for manual review.
* Otherwise calls `AiService.screenResume(job, text)` → `{score, summary, strengths[], gaps[]}`.
* Stores `aiScore`, `aiReason`, `aiScoredAt` — **never changes application status automatically**.
* Triggered automatically on first apply (ENTERPRISE plan only) and via `POST .../rescreen`.

---

## Assessment integrations (AssessmentIntegrationService)

Vendor-neutral boundary — the HRMS does not deliver tests or compute scores, it only:
1. Stores connection metadata (provider key, display name, encrypted webhook secret).
2. Lets recruiters link a vendor assessment to an application (`externalId` from the vendor).
3. Receives vendor webhook callbacks, verifies HMAC-SHA256 signature (timing-safe compare),
   updates `AssessmentRequest.status/score/recommendation/reportUrl`, creates timeline event.
4. Deduplicates callbacks via `AssessmentWebhookEvent(integrationId, providerEventId)` unique index.

---

## Rules & invariants

* **Tenant scoping:** every admin route filters by `user.tenantId`; the public listing is
  per slug and never exposes tenant UUIDs.
* **Consent** is required to apply (GDPR/DPDP lawful basis); captured in ApplicationEvent metadata.
* **Duplicate application** → 409; uploaded file is cleaned up from S3 before throwing.
* **Email content is escaped** — candidate names are attacker-controlled and would otherwise
  inject links into mail sent from the company's domain.
* **AI is advisory.** Scores are displayed with reasoning and never change status automatically.
  Slack alerts omit candidate email addresses.
* **Webhook secret** is only revealed once (on create) and on rotation; stored encrypted at rest.
* **Interview interviewer** must be an active user of the same workspace (prevents external email injection).

---

## Audit events logged

| Action | Trigger |
|---|---|
| `APPLICATION_STATUS` | `PATCH /hiring/applications/:id` |
| `HIRING_STAGE_CREATED` | `POST /hiring/stages` |
| `HIRING_STAGE_UPDATED` | `PATCH /hiring/stages/:id` |
| `ASSESSMENT_INTEGRATION_CREATED` | `POST /hiring/assessment-integrations` |
| `ASSESSMENT_WEBHOOK_SECRET_ROTATED` | `POST .../rotate-webhook-secret` |
| `ASSESSMENT_REQUEST_LINKED` | `POST /hiring/applications/:id/assessments` |

ApplicationEvent timeline also records: `APPLICATION_SUBMITTED`, `STAGE_CHANGED`,
`INTERVIEW_SCHEDULED`, `ASSESSMENT_REQUEST_LINKED`, `ASSESSMENT_STATUS_RECEIVED`.

---

## Tests

Security: cross-tenant status change → 404, careers isolation, no tenant-id leak in
public response. Workflows: apply → duplicate 409 → resume download → schedule interview
(past date rejected, non-user interviewer rejected) → manager cannot force-hire → admin
offers → hired; closed job rejects new applications.

---

## Known gaps / roadmap

See [`HIRING_ROADMAP.md`](HIRING_ROADMAP.md) for the detailed backlog. Summary:

| Gap | Priority |
|---|---|
| Collaborative interview feedback & scoring (per-interviewer rating model) | High |
| Recruitment analytics: source of hire, time-to-hire, time-per-stage | High |
| Interview reminder emails (pre-interview cron) + rescheduling flow | Medium |
| Admin UI for assessment integrations & pipeline stage reordering | Medium |
| Job board push integrations (LinkedIn, Indeed) | Low (optional) |
| Video interview provider (Zoom/Teams link auto-generation) | Low (optional) |
