-- Configurable recruiting stages and immutable candidate/application history.
-- Existing applications keep their current status and lazily receive a stage
-- on their next workflow action, so this migration is safe for live tenants.

ALTER TABLE "Application" ADD COLUMN "stageId" TEXT;

CREATE TABLE "HiringStage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HiringStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" TEXT NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HiringStage_tenantId_key_key" ON "HiringStage"("tenantId", "key");
CREATE INDEX "HiringStage_tenantId_isActive_position_idx" ON "HiringStage"("tenantId", "isActive", "position");
CREATE INDEX "Application_tenantId_stageId_idx" ON "Application"("tenantId", "stageId");
CREATE INDEX "ApplicationEvent_tenantId_applicationId_createdAt_idx" ON "ApplicationEvent"("tenantId", "applicationId", "createdAt");

ALTER TABLE "HiringStage" ADD CONSTRAINT "HiringStage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "HiringStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
