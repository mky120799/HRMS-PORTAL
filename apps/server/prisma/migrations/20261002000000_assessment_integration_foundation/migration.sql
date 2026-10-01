-- Vendor assessment integration foundation. HRMS tracks requests and results;
-- specialist vendors continue to host and score their assessments.

CREATE TABLE "AssessmentIntegration" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "webhookSecretEnc" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssessmentIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "externalId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "assessmentUrl" TEXT,
  "score" DECIMAL(5,2),
  "recommendation" TEXT,
  "reportUrl" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssessmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentWebhookEvent" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentIntegration_tenantId_provider_key" ON "AssessmentIntegration"("tenantId", "provider");
CREATE INDEX "AssessmentIntegration_tenantId_isActive_idx" ON "AssessmentIntegration"("tenantId", "isActive");
CREATE UNIQUE INDEX "AssessmentRequest_integrationId_externalId_key" ON "AssessmentRequest"("integrationId", "externalId");
CREATE INDEX "AssessmentRequest_tenantId_applicationId_status_idx" ON "AssessmentRequest"("tenantId", "applicationId", "status");
CREATE INDEX "AssessmentRequest_integrationId_status_idx" ON "AssessmentRequest"("integrationId", "status");
CREATE UNIQUE INDEX "AssessmentWebhookEvent_integrationId_providerEventId_key" ON "AssessmentWebhookEvent"("integrationId", "providerEventId");

ALTER TABLE "AssessmentIntegration" ADD CONSTRAINT "AssessmentIntegration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "AssessmentIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentWebhookEvent" ADD CONSTRAINT "AssessmentWebhookEvent_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "AssessmentIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
