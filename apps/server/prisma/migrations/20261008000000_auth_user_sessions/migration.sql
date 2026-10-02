-- Multi-session authentication foundation.

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key"
  ON "UserSession"("refreshTokenHash");
CREATE INDEX "UserSession_tenantId_userId_idx"
  ON "UserSession"("tenantId", "userId");
CREATE INDEX "UserSession_userId_revokedAt_idx"
  ON "UserSession"("userId", "revokedAt");
CREATE INDEX "UserSession_expiresAt_idx"
  ON "UserSession"("expiresAt");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
