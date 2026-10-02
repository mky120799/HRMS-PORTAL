-- Password policy support: password history and changed timestamp.

ALTER TABLE "User"
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

CREATE TABLE "UserPasswordHistory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserPasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserPasswordHistory_tenantId_userId_createdAt_idx"
  ON "UserPasswordHistory"("tenantId", "userId", "createdAt");

ALTER TABLE "UserPasswordHistory"
  ADD CONSTRAINT "UserPasswordHistory_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPasswordHistory"
  ADD CONSTRAINT "UserPasswordHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
