-- Authentication completion: replay protection, SAML attribute mapping, indexed SCIM token lookup.

CREATE TABLE "AuthReplayGuard" (
  "key" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthReplayGuard_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AuthReplayGuard_expiresAt_idx" ON "AuthReplayGuard"("expiresAt");

ALTER TABLE "TenantIdentityProvider" ADD COLUMN "attributeMapping" JSONB;

-- SCIM tokens are 256-bit random values, so their SHA-256 digests never collide in practice.
CREATE UNIQUE INDEX "TenantIdentityProvider_scimTokenHash_key"
  ON "TenantIdentityProvider"("scimTokenHash");
