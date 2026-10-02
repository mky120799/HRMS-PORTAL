-- Enterprise identity provider configuration foundation for OIDC/SAML and SCIM.

CREATE TABLE "TenantIdentityProvider" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "providerType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuerUrl" TEXT,
  "clientId" TEXT,
  "clientSecretEnc" TEXT,
  "samlEntityId" TEXT,
  "samlSsoUrl" TEXT,
  "samlCertificateEnc" TEXT,
  "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "roleMapping" JSONB,
  "jitProvisioning" BOOLEAN NOT NULL DEFAULT false,
  "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
  "scimTokenHash" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantIdentityProvider_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantIdentityProvider_tenantId_providerType_isActive_idx"
  ON "TenantIdentityProvider"("tenantId", "providerType", "isActive");

ALTER TABLE "TenantIdentityProvider"
  ADD CONSTRAINT "TenantIdentityProvider_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
