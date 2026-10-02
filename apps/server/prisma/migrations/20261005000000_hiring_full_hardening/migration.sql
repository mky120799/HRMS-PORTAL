-- Hiring reliability and workflow hardening.

ALTER TABLE "Application"
  ADD COLUMN "interviewDurationMinutes" INTEGER,
  ADD COLUMN "interviewLocation" TEXT,
  ADD COLUMN "interviewScheduleVersion" INTEGER NOT NULL DEFAULT 0;

-- The previous reminder migration used a partial index that Prisma cannot
-- represent. Replace it with the declared full index so schema drift checks
-- remain deterministic across clean and upgraded databases.
DROP INDEX IF EXISTS "Application_tenantId_interviewAt_idx";
CREATE INDEX "Application_tenantId_interviewAt_idx"
  ON "Application"("tenantId", "interviewAt");

ALTER TABLE "Notification"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "processingAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Notification_tenantId_idempotencyKey_key"
  ON "Notification"("tenantId", "idempotencyKey");

CREATE TABLE "HiringOutboxEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "applicationId" TEXT,
  "eventKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HiringOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HiringOutboxEvent_tenantId_eventKey_key"
  ON "HiringOutboxEvent"("tenantId", "eventKey");
CREATE INDEX "HiringOutboxEvent_status_availableAt_idx"
  ON "HiringOutboxEvent"("status", "availableAt");
CREATE INDEX "HiringOutboxEvent_tenantId_applicationId_idx"
  ON "HiringOutboxEvent"("tenantId", "applicationId");

ALTER TABLE "HiringOutboxEvent" ADD CONSTRAINT "HiringOutboxEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HiringOutboxEvent" ADD CONSTRAINT "HiringOutboxEvent_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing tenants receive canonical stages. Deterministic UUID-formatted IDs
-- avoid requiring a PostgreSQL extension during deployment.
WITH stage_values("key", "name", "category", "position") AS (
  VALUES
    ('APPLIED', 'Applied', 'APPLIED', 10),
    ('SCREENING', 'Screening', 'SCREENING', 20),
    ('INTERVIEW', 'Interview', 'INTERVIEW', 30),
    ('OFFERED', 'Offer', 'OFFERED', 40),
    ('HIRED', 'Hired', 'HIRED', 50),
    ('REJECTED', 'Rejected', 'REJECTED', 60)
), stage_rows AS (
  SELECT t."id" AS "tenantId", s."key", s."name", s."category", s."position",
         md5(t."id" || ':hiring-stage:' || s."key") AS hash
  FROM "Tenant" t CROSS JOIN stage_values s
)
INSERT INTO "HiringStage" ("id", "tenantId", "key", "name", "category", "position", "isActive", "createdAt", "updatedAt")
SELECT substr(hash, 1, 8) || '-' || substr(hash, 9, 4) || '-5' || substr(hash, 14, 3) || '-8' || substr(hash, 18, 3) || '-' || substr(hash, 21, 12),
       "tenantId", "key", "name", "category", "position", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM stage_rows
ON CONFLICT ("tenantId", "key") DO NOTHING;

-- Assign a matching current stage only. Historical events are deliberately not
-- fabricated because their true transition timestamps are unknown.
UPDATE "Application" a
SET "stageId" = s."id"
FROM "HiringStage" s
WHERE a."stageId" IS NULL
  AND s."tenantId" = a."tenantId"
  AND s."key" = a."status";
