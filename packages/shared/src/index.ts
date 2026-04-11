export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
}

export const TENANT_HEADER = 'x-tenant-id';
