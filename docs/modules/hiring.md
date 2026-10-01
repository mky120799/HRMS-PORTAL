# Hiring module

`apps/server/src/modules/hiring` · uses `ai`, `integrations/slack`, `common/storage`,
`common/email`, `common/messaging` (RabbitMQ)

## Purpose

End-to-end recruiting: public careers page → candidate application → configurable pipeline
stages → AI resume screening → interview scheduling → collaborative feedback →
assessment integrations → audit trail → recruitment analytics.

---

## Services

| Service | Responsibility |
|---|---|
| `HiringService` | Jobs CRUD, public careers page, apply (multipart), resume download, status updates, interview scheduling (reschedule-aware) |
| `HiringWorkflowService` | Pipeline stages CRUD, application move, immutable event timeline |
| `HiringFeedbackService` | Per-interviewer feedback upsert, aggregate stats (avg rating, recommendation tally) |
| `AssessmentIntegrationService` | Assessment vendor connections, webhook HMAC verification, request lifecycle |
| `HiringProcessor` | AI resume screening consumer (RabbitMQ, concurrency 2) + hourly interview reminder sweep |

---

## Schema additions (migration 20261004)

| Column / Table | Purpose |
|---|---|
| `Application.source` | Acquisition channel — `CAREERS_SITE \| LINKEDIN \| INDEED \| REFERRAL \| OTHER` |
| `Application.interviewReminderSentAt` | Idempotency fence — set after reminder email sent; cleared on reschedule |
| `InterviewFeedback` | One record per reviewer per application (upsert). Stores `rating` (1–5), `recommendation` enum, `notes` |

---

## API surface

### Careers (public, no auth)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/careers/:slug` | Lists open jobs for the tenant identified by slug |
| `POST` | `/careers/:slug/:jobId/apply` | `multipart/form-data` — name, email, consent, optional `source`, resume file |

### Jobs (ADMIN/MANAGER, BASIC plan)
| Method | Path |
|---|---|
| `GET` | `/hiring/jobs` |
| `POST` | `/hiring/jobs` |
| `PATCH` | `/hiring/jobs/:id` |

### Pipeline stages (ADMIN/MANAGER)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/hiring/stages` | Auto-seeds default stages on first call |
| `POST` | `/hiring/stages` | ADMIN only |
| `PATCH` | `/hiring/stages/:id` | name, position, isActive — ADMIN only |

### Applications (ADMIN/MANAGER)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/hiring/applications` | `?jobId, status, source, page, pageSize` |
| `PATCH` | `/hiring/applications/:id` | Status update — emails candidate |
| `POST` | `/hiring/applications/:id/move` | Move to a specific stage |
| `GET` | `/hiring/applications/:id/timeline` | Immutable event log |
| `GET` | `/hiring/applications/:id/resume` | Signed stream from S3 |
| `POST` | `/hiring/applications/:id/schedule-interview` | `isReschedule: boolean` — sends correct email template |
| `POST` | `/hiring/applications/:id/rescreen` | ADMIN + ENTERPRISE plan — re-queues AI screening |

### Interview Feedback (ADMIN/MANAGER)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/hiring/applications/:id/feedback` | All reviewer feedback + aggregate stats |
| `POST` | `/hiring/applications/:id/feedback` | Upsert own feedback (one record per reviewer) |
| `DELETE` | `/hiring/applications/:id/feedback` | Remove own feedback |

### Assessment Integrations (ADMIN)
| Method | Path | Notes |
|---|---|---|
| `GET` | `/hiring/assessment-integrations` | |
| `POST` | `/hiring/assessment-integrations` | Generates webhook secret — returned once, stored encrypted |
| `POST` | `/hiring/assessment-integrations/:id/rotate-webhook-secret` | Issues new secret |
| `GET` | `/hiring/applications/:id/assessments` | |
| `POST` | `/hiring/applications/:id/assessments` | |

### Vendor webhook (public, HMAC-verified)
| Method | Path |
|---|---|
| `POST` | `/hiring/webhooks/assessment/:integrationId` |

### Analytics (`GET /analytics/hiring`, ADMIN/MANAGER, BUSINESS plan)
Returns a single parallel query batch:
- **Source of hire** — applied + hired counts per `source` value
- **Time to hire** — avg and median days from `createdAt` to first `HIRED` event
- **Time per stage** — median days in each stage (derived from `ApplicationEvent` timestamps via `LEAD()` window)
- **Offer acceptance rate** — `HIRED / (OFFERED + HIRED)`

---

## Background jobs (HiringProcessor)

### AI screening
- Triggered by `HIRING_QUEUE` RabbitMQ message on every new application.
- Extracts resume text → `AiService.screenResume()` → writes `aiScore`, `aiReason`, `aiScoredAt`.
- Concurrency 2, 3 attempts, 60 s retry delay. Skips if text < 100 chars.
- Score is **advisory only** — never used to auto-reject.

### Interview reminder sweep
- Runs **every hour** (`setInterval` after 30 s warm-up).
- Finds `status=INTERVIEW` applications with `interviewAt` within the next 24 h and `interviewReminderSentAt IS NULL`.
- Sends `interviewReminder` email to candidate and (if set) the interviewer.
- Marks `interviewReminderSentAt` via `updateMany` for idempotency (handles concurrent pods).
- Logs `INTERVIEW_REMINDER_SENT` to the application event timeline.

---

## Email templates (all HTML-escaped)

| Template | Trigger |
|---|---|
| `applicationReceived` | On apply |
| `applicationStatus` | On status change |
| `interviewScheduled` | New interview |
| `interviewRescheduled` | `isReschedule: true` on schedule endpoint |
| `interviewReminder` | ~24 h before interview (processor sweep) |

---

## Frontend

### `/hiring`
- Job creation form (ADMIN), jobs grid with open/close toggle.
- Candidates table: name, role, **source badge**, AI score (colour-coded), stage selector, resume download, interview/reschedule button, feedback button.
- **Schedule dialog** — detects existing `interviewAt` and shows reschedule warning banner; sends correct email variant.
- **Feedback dialog** — shows all reviewer cards (stars, recommendation chip, expandable notes) and submit-my-own-feedback form.

### Settings → Hiring (`/settings`, ADMIN)
Powered by `HiringSettingsPanel`:
- Assessment integrations list — add, rotate secret (shown once with copy button), active badge.
- Pipeline stages list — up/down reorder, toggle active/inactive, add stage dialog.

### Analytics → Recruitment KPIs (`/analytics`)
- Stat cards: avg time-to-hire, offer acceptance rate, total applicants / hired.
- Source of hire horizontal bar chart.
- Median days per stage horizontal bar chart.

---

## Security notes

- Public careers pages use the tenant's **slug**, not `tenantId`, to prevent enumeration.
- Resume files are stored in S3 under a private key; download requires a valid session token.
- Webhook callbacks are verified using **HMAC-SHA256** against the per-integration secret (stored AES-256-GCM encrypted).
- AI screening is strictly advisory — no automated rejection path exists in the codebase.
- All sensitive mutations write to the audit log.
