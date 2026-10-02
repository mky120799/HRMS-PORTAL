-- Notification platform foundation
-- Existing Notification rows are preserved. New rows may be linked to a
-- business event while legacy email/in-app history remains readable.

ALTER TABLE "Notification"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "eventType" TEXT,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "link" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve the old READ status as an explicit timestamp for the new inbox.
UPDATE "Notification"
SET "readAt" = COALESCE("sentAt", "createdAt")
WHERE "channel" = 'IN_APP' AND "status" = 'READ';

CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "actorUserId" TEXT,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationOutboxEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "notificationEventId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "encryptedPayload" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL DEFAULT '*',
  "channel" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationEvent_tenantId_eventKey_key"
  ON "NotificationEvent"("tenantId", "eventKey");
CREATE INDEX "NotificationEvent_tenantId_eventType_createdAt_idx"
  ON "NotificationEvent"("tenantId", "eventType", "createdAt");

CREATE UNIQUE INDEX "NotificationOutboxEvent_tenantId_eventKey_key"
  ON "NotificationOutboxEvent"("tenantId", "eventKey");
CREATE INDEX "NotificationOutboxEvent_status_availableAt_idx"
  ON "NotificationOutboxEvent"("status", "availableAt");
CREATE INDEX "NotificationOutboxEvent_tenantId_notificationEventId_idx"
  ON "NotificationOutboxEvent"("tenantId", "notificationEventId");

CREATE UNIQUE INDEX "NotificationPreference_tenantId_userId_eventType_channel_key"
  ON "NotificationPreference"("tenantId", "userId", "eventType", "channel");
CREATE INDEX "NotificationPreference_tenantId_userId_idx"
  ON "NotificationPreference"("tenantId", "userId");

CREATE INDEX "Notification_tenantId_recipientUserId_readAt_archivedAt_idx"
  ON "Notification"("tenantId", "recipientUserId", "readAt", "archivedAt");
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");

ALTER TABLE "NotificationEvent"
  ADD CONSTRAINT "NotificationEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutboxEvent"
  ADD CONSTRAINT "NotificationOutboxEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutboxEvent"
  ADD CONSTRAINT "NotificationOutboxEvent_notificationEventId_fkey"
  FOREIGN KEY ("notificationEventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NotificationCampaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "processedRecipients" INTEGER NOT NULL DEFAULT 0,
  "failedRecipients" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationCampaignRecipient" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationCampaign_tenantId_createdAt_idx"
  ON "NotificationCampaign"("tenantId", "createdAt");
CREATE INDEX "NotificationCampaign_status_scheduledAt_lockedAt_idx"
  ON "NotificationCampaign"("status", "scheduledAt", "lockedAt");
CREATE UNIQUE INDEX "NotificationCampaignRecipient_campaignId_email_key"
  ON "NotificationCampaignRecipient"("campaignId", "email");
CREATE INDEX "NotificationCampaignRecipient_tenantId_campaignId_status_availableAt_idx"
  ON "NotificationCampaignRecipient"("tenantId", "campaignId", "status", "availableAt");

ALTER TABLE "NotificationCampaign"
  ADD CONSTRAINT "NotificationCampaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationCampaignRecipient"
  ADD CONSTRAINT "NotificationCampaignRecipient_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationCampaignRecipient"
  ADD CONSTRAINT "NotificationCampaignRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
