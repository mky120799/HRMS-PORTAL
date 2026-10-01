-- Migration: hiring_feedback_and_improvements
-- Adds InterviewFeedback model, source field on Application,
-- interviewReminderSentAt for dedup of reminder emails.

-- 1. Source of hire field
ALTER TABLE "Application" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'CAREERS_SITE';

-- 2. Interview reminder dedup
ALTER TABLE "Application" ADD COLUMN "interviewReminderSentAt" TIMESTAMP(3);

-- 3. InterviewFeedback table
CREATE TABLE "InterviewFeedback" (
  "id"             TEXT         NOT NULL,
  "tenantId"       TEXT         NOT NULL,
  "applicationId"  TEXT         NOT NULL,
  "authorUserId"   TEXT         NOT NULL,
  "rating"         INTEGER      NOT NULL,
  "recommendation" TEXT         NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InterviewFeedback_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "InterviewFeedback_applicationId_authorUserId_key"
  ON "InterviewFeedback"("applicationId", "authorUserId");

CREATE INDEX "InterviewFeedback_tenantId_applicationId_idx"
  ON "InterviewFeedback"("tenantId", "applicationId");

CREATE INDEX "Application_tenantId_interviewAt_idx"
  ON "Application"("tenantId", "interviewAt")
  WHERE "interviewAt" IS NOT NULL AND "interviewReminderSentAt" IS NULL;

-- Foreign keys
ALTER TABLE "InterviewFeedback"
  ADD CONSTRAINT "InterviewFeedback_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewFeedback"
  ADD CONSTRAINT "InterviewFeedback_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewFeedback"
  ADD CONSTRAINT "InterviewFeedback_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
