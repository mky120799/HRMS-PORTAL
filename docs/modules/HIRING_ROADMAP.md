# Hiring module — roadmap & gaps

Status as of **2026-10-02**.
Items H1, H2, H3 were implemented in the same session.
Cross-reference with [`hiring.md`](hiring.md) for what is already built.

---

## ✅ H1 — Collaborative interview feedback & scoring *(Done)*

**Implemented:**
- New `InterviewFeedback` Prisma model (`@@unique [applicationId, authorUserId]`) — one record per reviewer per application, upserted on re-submission.
- `HiringFeedbackService` with `list()`, `upsert()`, `remove()`.
- `GET/POST/DELETE /hiring/applications/:id/feedback` endpoints (MANAGER+ can read and submit; authors can delete their own).
- `list()` returns feedback items plus aggregate: count, average rating, recommendation tally.
- Every submit/update/delete writes an `ApplicationEvent` entry and an `AuditLog`.
- Frontend: feedback dialog on the candidates table showing existing reviewer cards (star ratings, recommendation chips, expandable notes) and a submit-my-feedback form.

---

## ✅ H2 — Recruitment analytics: source of hire, time-to-hire, time-per-stage *(Done)*

**Implemented:**
- `source` field added to `Application` (default `CAREERS_SITE`); accepted as optional field on `/careers/.../apply`.
- `source` filter added to `GET /hiring/applications?source=`.
- `AnalyticsService.hiringMetrics()` — all-parallel query batch:
  - Source of hire: count by source (applied + hired).
  - Time to hire: avg and median days from `createdAt` to `HIRED` event (uses `ApplicationEvent` timestamps).
  - Time per stage: median days per stage using window `LEAD()` on `STAGE_CHANGED` events.
  - Offer acceptance rate: `HIRED / (OFFERED + HIRED)`.
- `GET /analytics/hiring` (ADMIN/MANAGER, BUSINESS plan).
- Source-of-hire badge column added to candidates table on the frontend.

---

## ✅ H3 — Interview reminders & rescheduling *(Done)*

**Implemented:**
- `interviewReminderSentAt` field on `Application` as an idempotency fence.
- `HiringProcessor.sendInterviewReminders()` — runs every hour, finds upcoming interviews (within 24 h window), sends `interviewReminder` emails to candidate and interviewer, then sets `interviewReminderSentAt` via `updateMany` to prevent duplicate delivery. Logs `INTERVIEW_REMINDER_SENT` event to the timeline.
- `isReschedule: boolean` added to `scheduleInterviewSchema`. When `true`, clears `interviewReminderSentAt` (re-arms the reminder) and sends `interviewRescheduled` email template instead of `interviewScheduled`. Audit logs `INTERVIEW_RESCHEDULED` event.
- New email templates: `interviewRescheduled`, `interviewReminder`.
- Frontend: button shows "Reschedule" (with cycle icon) when interview already exists; amber warning banner in dialog explains the reschedule behaviour.

---

## ✅ H4 — Admin UI for assessment integrations & stage reordering *(Done)*

**Implemented (`HiringSettingsPanel` component embedded in Settings → Hiring):**
- Assessment integrations list — provider key, display name, active badge.
- "Add integration" dialog — provider key input (sanitised to uppercase), display name. On create, the webhook secret is shown once with a copy button.
- "Rotate secret" button per integration (with confirmation dialog).
- Pipeline stages list — ordered by position, with up/down reorder buttons (swaps positions via `PATCH /hiring/stages/:id`).
- Toggle active/inactive per stage.
- "Add stage" dialog — key (uppercase, auto-sanitised), display name, category dropdown, position number.
- Category colour badge on each stage row matches the hiring page badges.
- `AnalyticsPage` updated with Recruitment KPIs section:
  - Three stat cards: avg time-to-hire (with median sub-label), offer acceptance rate, total applicants/hired.
  - Source of hire — horizontal bar chart (applied vs hired per channel).
  - Median days per stage — horizontal bar chart.
  - All data from `GET /analytics/hiring` (loads independently, gracefully empty while no data exists).

---

## H5 — Job board integrations *(Low — optional)*

Not started. See original roadmap description.

---

## H6 — Video interview provider *(Low — optional)*

Not started. See original roadmap description.


---

## H1 — Collaborative interview feedback & scoring *(High priority)*

**What's missing:** No structured feedback model. Interviewers can leave a `note` field when
moving a stage, but there is no per-interviewer rating, competency rubric, or hiring recommendation.
Panel-interview aggregation does not exist.

### Schema addition

```prisma
model InterviewFeedback {
  id             String   @id @default(uuid())
  tenantId       String
  applicationId  String
  authorUserId   String
  rating         Int      // 1–5 overall
  recommendation String   // STRONG_YES | YES | NEUTRAL | NO | STRONG_NO
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant      Tenant      @relation(fields: [tenantId], references: [id])
  application Application @relation(fields: [applicationId], references: [id])
  author      User        @relation(fields: [authorUserId], references: [id])

  @@unique([applicationId, authorUserId])   // one feedback per reviewer per application
  @@index([tenantId, applicationId])
}
```

### API additions

| Method & path | Role | Notes |
|---|---|---|
| `POST /hiring/applications/:id/feedback` | MANAGER+ | Submit or update own feedback |
| `GET /hiring/applications/:id/feedback` | MANAGER+ | All feedback for the application |

### Frontend additions

- Application detail side-panel (or expand row) showing:
  - Feedback cards per interviewer (rating stars, recommendation chip, notes)
  - Aggregate score bar (average rating across reviewers)
  - "Submit my feedback" form (only visible to interviewers assigned to this application)

---

## H2 — Recruitment analytics: source of hire, time-to-hire, time-per-stage *(High priority)*

**What's missing:** The analytics overview only shows a funnel count. No time-based or
source-based metrics exist.

### Schema addition

Add `source` field to `Application`:

```prisma
// In model Application:
source  String  @default("CAREERS_SITE") // CAREERS_SITE | LINKEDIN | INDEED | REFERRAL | OTHER
```

Set `source` from the apply endpoint (passed as an optional query param or field), and from
future job-board webhook callbacks.

### Analytics service additions

New endpoint `GET /analytics/hiring` (ADMIN, MANAGER, BUSINESS plan):

```typescript
// Queries to add:
// 1. Time-to-hire: AVG(EXTRACT days from hiredAt - createdAt) for HIRED applications
//    hiredAt = MAX(createdAt) from ApplicationEvent where type='STAGE_CHANGED' and toStatus='HIRED'
// 2. Time-per-stage: median days each application spent in each category
//    derived from consecutive ApplicationEvent timestamps
// 3. Source of hire: GROUP BY source, COUNT(*) where status='HIRED'
// 4. Offer acceptance rate: HIRED / OFFERED
```

Response shape:
```json
{
  "timeToHire": { "avgDays": 18.4, "medianDays": 15 },
  "timePerStage": [
    { "stage": "APPLIED",   "medianDays": 2 },
    { "stage": "SCREENING", "medianDays": 4 },
    { "stage": "INTERVIEW", "medianDays": 7 },
    { "stage": "OFFERED",   "medianDays": 3 }
  ],
  "sourceOfHire": [
    { "source": "CAREERS_SITE", "applied": 120, "hired": 8 },
    { "source": "LINKEDIN",     "applied": 45,  "hired": 3 }
  ],
  "offerAcceptanceRate": 72.5
}
```

### Frontend additions

- New "Recruitment" tab/section on `AnalyticsPage` (or separate `RecruitmentAnalyticsPage`).
- Cards: Average time-to-hire, median days per stage (horizontal bar), source pie chart,
  offer acceptance rate.

---

## H3 — Interview reminders & rescheduling *(Medium priority)*

**What's missing:**
- No pre-interview reminder email sent to candidate or interviewer.
- No rescheduling flow — a new `POST .../schedule-interview` call silently overwrites the
  previous time without notifying the candidate of the change.

### Reminder cron

Add a scheduled job (e.g. via the existing queue scheduler or a dedicated cron service):
- Queries `Application` where `status = 'INTERVIEW'` and `interviewAt BETWEEN now() AND now() + 24h`
  and `reminderSentAt IS NULL`.
- Sends reminder email to candidate and interviewer.
- Sets `reminderSentAt` (new nullable `DateTime` field on Application) to prevent re-delivery.

### Rescheduling

Add `isReschedule` boolean to `ScheduleInterviewDto`. When `true`:
- Sends a "your interview time has changed" email template instead of the standard invite.
- Creates an `INTERVIEW_RESCHEDULED` ApplicationEvent instead of `INTERVIEW_SCHEDULED`.
- Frontend "Interview" button shows "Reschedule" when `interviewAt` is already set.

---

## H4 — Admin UI for assessment integrations & stage reordering *(Medium priority)*

**What's missing:**
- `POST /hiring/assessment-integrations` and related endpoints are API-only; there is no
  frontend settings screen to configure them.
- Pipeline stage CRUD (create/rename/reorder) exists in the API but has no UI.

### Frontend additions

**Settings → Hiring tab:**
- Assessment integrations list table (provider, display name, status, "Rotate secret" button).
- "Add integration" dialog: provider key, display name.

**Hiring page — Pipeline settings drawer:**
- Drag-and-drop ordered list of active stages.
- "Add stage" form: name, category, position.
- Toggle active/inactive per stage.

---

## H5 — Job board integrations *(Low — optional)*

**Not started.** Would require:
- Per-integration outbound adapter (LinkedIn, Indeed, etc.) triggered on job create/close.
- Inbound webhook to receive applications from job boards and create `Application` records
  with the appropriate `source` tag.
- `JobBoardIntegration` model (similar pattern to `AssessmentIntegration`).

---

## H6 — Video interview provider *(Low — optional)*

**Not started.** Would require:
- Integration with a video platform (Zoom, Google Meet API, Teams).
- On `scheduleInterview`, auto-create a meeting and store the join URL.
- Replace manual "Location or video link" field with an auto-generated meeting link.
- Requires storing OAuth tokens per tenant (security/complexity overhead).
