# Hiring module

`apps/server/src/modules/hiring` · uses `ai`, `integrations/slack`, `common/storage`, `common/email`

## Purpose
Public careers page per company, applicant pipeline, interview scheduling and advisory AI screening.

## Data
* `Job(tenantId, title, description, department, location, status OPEN|CLOSED)`
* `Application(tenantId, jobId, candidateName, candidateEmail, resumeKey, resumeMimeType,
  resumeFilename, status, aiScore, aiReason, aiScoredAt, interviewAt, interviewerEmail)`,
  unique `(jobId, candidateEmail)`.

Pipeline: `APPLIED → SCREENING → INTERVIEW → OFFERED → HIRED` (or `REJECTED` at any point).

## Endpoints

| Method & path | Access | Notes |
| --- | --- | --- |
| `GET /careers/:slug` | public | Company name + open jobs. **No tenant ids** in the response |
| `POST /careers/:slug/jobs/:jobId/apply` | public, 5 per 10 min per IP | multipart: `candidateName`, `candidateEmail`, `consent=true`, `resume` (PDF/DOCX ≤ 5 MB) |
| `GET /hiring/jobs` | MANAGER, ADMIN (BASIC) | |
| `POST /hiring/jobs` · `PATCH /hiring/jobs/:id` | ADMIN | open/close, edit |
| `GET /hiring/applications?jobId&status&page` | MANAGER, ADMIN | |
| `GET /hiring/applications/:id/resume` | MANAGER, ADMIN | streamed from private storage |
| `PATCH /hiring/applications/:id` | ADMIN | emails the candidate for SCREENING/OFFERED/HIRED/REJECTED |
| `POST /hiring/applications/:id/schedule-interview` | MANAGER, ADMIN | `startsAt`, `durationMinutes`, `interviewerEmail?`, `location?` |
| `POST /hiring/applications/:id/rescreen` | ADMIN (ENTERPRISE) | re-queue AI screening |

## Flow

```mermaid
sequenceDiagram
  participant C as Candidate
  participant API
  participant S3
  participant Q as hiring queue
  participant AI as Gemini
  C->>API: apply (multipart)
  API->>API: validate job belongs to /careers/:slug and is OPEN; sniff file type
  API->>S3: put tenants/<id>/resumes/<job>/<uuid>.pdf
  API->>API: create Application (unique job+email)
  API-->>C: 201 + confirmation email
  API->>Q: screen (if AI enabled and plan allows)
  Q->>S3: fetch resume
  Q->>AI: resume text + job description
  AI-->>Q: {score, summary, strengths, gaps}
  Q->>API: store advisory score + reasoning
```

## Rules
* **Tenant scoping:** the public listing is per slug (the original returned *every* company's
  jobs including tenant ids, which enabled account takeover). Every admin route filters by tenant.
* **Consent** is required to apply (GDPR/DPDP lawful basis), with the text shown on the form.
* **Duplicate applications** → 409; the stored file is cleaned up.
* **Email content is escaped** — candidate names are attacker-controlled and would otherwise
  inject links into mail sent from the company's domain.
* **Interview scheduling** stores the time and emails candidate + interviewer an
  "Add to Google Calendar" link. The interviewer must be an active user of the workspace. There
  is no shared Google account (the original used one global calendar for all customers).
* **AI is advisory.** Scores are displayed with their reasoning and never change status
  automatically. Slack alerts omit candidate emails.

## Tests
Security: cross-tenant status change → 404, careers isolation, no tenant id leak. Workflows:
apply → duplicate 409 → resume download → schedule → manager cannot hire → admin offers;
closed job rejects applications.
