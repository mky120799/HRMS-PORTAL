-- Notification delivery controls, digests, suppression, and provider webhooks.

CREATE TABLE "NotificationDeliverySetting" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietStartMinutes" INTEGER,
  "quietEndMinutes" INTEGER,
  "digestFrequency" TEXT NOT NULL DEFAULT 'IMMEDIATE',
  "digestHour" INTEGER NOT NULL DEFAULT 9,
  "digestDayOfWeek" INTEGER NOT NULL DEFAULT 1,
  "lastDigestSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDeliverySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDigestItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "digestKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "notificationId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "NotificationDigestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationSuppression" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'SES',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "count" INTEGER NOT NULL DEFAULT 1,
  "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationWebhookEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "notificationId" TEXT,
  "email" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'SES',
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "version" INTEGER NOT NULL,
  "subjectTemplate" TEXT NOT NULL,
  "htmlTemplate" TEXT NOT NULL,
  "textTemplate" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDeliverySetting_tenantId_userId_key"
  ON "NotificationDeliverySetting"("tenantId", "userId");
CREATE INDEX "NotificationDeliverySetting_tenantId_userId_idx"
  ON "NotificationDeliverySetting"("tenantId", "userId");

CREATE UNIQUE INDEX "NotificationDigestItem_tenantId_digestKey_key"
  ON "NotificationDigestItem"("tenantId", "digestKey");
CREATE INDEX "NotificationDigestItem_tenantId_userId_status_availableAt_idx"
  ON "NotificationDigestItem"("tenantId", "userId", "status", "availableAt");
CREATE INDEX "NotificationDigestItem_status_availableAt_idx"
  ON "NotificationDigestItem"("status", "availableAt");

CREATE UNIQUE INDEX "NotificationSuppression_tenantId_email_key"
  ON "NotificationSuppression"("tenantId", "email");
CREATE INDEX "NotificationSuppression_tenantId_active_reason_idx"
  ON "NotificationSuppression"("tenantId", "active", "reason");

CREATE INDEX "NotificationWebhookEvent_tenantId_receivedAt_idx"
  ON "NotificationWebhookEvent"("tenantId", "receivedAt");
CREATE INDEX "NotificationWebhookEvent_notificationId_idx"
  ON "NotificationWebhookEvent"("notificationId");

CREATE UNIQUE INDEX "NotificationTemplate_tenantId_eventType_channel_version_key"
  ON "NotificationTemplate"("tenantId", "eventType", "channel", "version");
CREATE INDEX "NotificationTemplate_tenantId_eventType_channel_isActive_idx"
  ON "NotificationTemplate"("tenantId", "eventType", "channel", "isActive");

ALTER TABLE "NotificationDeliverySetting"
  ADD CONSTRAINT "NotificationDeliverySetting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDigestItem"
  ADD CONSTRAINT "NotificationDigestItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationSuppression"
  ADD CONSTRAINT "NotificationSuppression_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationWebhookEvent"
  ADD CONSTRAINT "NotificationWebhookEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationTemplate"
  ADD CONSTRAINT "NotificationTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
