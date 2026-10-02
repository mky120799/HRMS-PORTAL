-- Workspace-defined roles and SCIM group provisioning.

CREATE TABLE "CustomRole" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "baseRole" TEXT NOT NULL,
  "permissions" TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomRole_tenantId_key_key" ON "CustomRole"("tenantId", "key");

ALTER TABLE "CustomRole"
  ADD CONSTRAINT "CustomRole_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "customRoleId" TEXT;
-- "idp:<providerId>" when the role came from IdP group mapping, so SCIM may later take it away again.
ALTER TABLE "User" ADD COLUMN "roleManagedBy" TEXT;

-- A role that is still assigned cannot be deleted (deactivate or reassign first).
ALTER TABLE "User"
  ADD CONSTRAINT "User_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ScimGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "externalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScimGroup_providerId_displayName_key" ON "ScimGroup"("providerId", "displayName");
CREATE INDEX "ScimGroup_tenantId_idx" ON "ScimGroup"("tenantId");

ALTER TABLE "ScimGroup"
  ADD CONSTRAINT "ScimGroup_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroup"
  ADD CONSTRAINT "ScimGroup_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "TenantIdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScimGroupMember" (
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("groupId", "userId")
);

CREATE INDEX "ScimGroupMember_userId_idx" ON "ScimGroupMember"("userId");

ALTER TABLE "ScimGroupMember"
  ADD CONSTRAINT "ScimGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupMember"
  ADD CONSTRAINT "ScimGroupMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
