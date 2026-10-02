-- Tenant-level authentication policy controls.

CREATE TABLE "TenantAuthPolicy" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "allowPasswordLogin" BOOLEAN NOT NULL DEFAULT true,
  "allowGoogleLogin" BOOLEAN NOT NULL DEFAULT true,
  "requireMfaForAdmins" BOOLEAN NOT NULL DEFAULT false,
  "requireMfaForAll" BOOLEAN NOT NULL DEFAULT false,
  "passwordMinLength" INTEGER NOT NULL DEFAULT 10,
  "passwordHistoryCount" INTEGER NOT NULL DEFAULT 0,
  "passwordExpiresDays" INTEGER,
  "sessionIdleMinutes" INTEGER,
  "sessionAbsoluteHours" INTEGER NOT NULL DEFAULT 168,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantAuthPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAuthPolicy_tenantId_key"
  ON "TenantAuthPolicy"("tenantId");

ALTER TABLE "TenantAuthPolicy"
  ADD CONSTRAINT "TenantAuthPolicy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
