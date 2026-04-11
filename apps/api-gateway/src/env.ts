import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  tenantServiceUrl: required('TENANT_SERVICE_URL'),
  authServiceUrl: required('AUTH_SERVICE_URL'),
  employeeServiceUrl: required('EMPLOYEE_SERVICE_URL'),
  leaveServiceUrl: required('LEAVE_SERVICE_URL'),
  notificationsServiceUrl: required('NOTIFICATIONS_SERVICE_URL'),
  internalServiceSecret: required('INTERNAL_SERVICE_SECRET'),
};
