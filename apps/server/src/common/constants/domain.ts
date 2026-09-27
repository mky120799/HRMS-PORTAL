/**
 * Domain vocabularies. Status and role columns are stored as strings in the
 * database; these tuples are the only values the API accepts or writes.
 */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];
/** Roles a tenant admin may assign. SUPER_ADMIN is platform-only. */
export const TENANT_ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'] as const;

export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Seeded for every new tenant; admins can change quotas afterwards. */
export const DEFAULT_LEAVE_POLICIES = [
  { type: 'ANNUAL', annualQuota: 18, isPaid: true },
  { type: 'SICK', annualQuota: 12, isPaid: true },
  { type: 'CASUAL', annualQuota: 6, isPaid: true },
  { type: 'UNPAID', annualQuota: 0, isPaid: false },
] as const;

export const JOB_STATUSES = ['OPEN', 'CLOSED'] as const;
export const APPLICATION_STATUSES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PAYSLIP_STATUSES = ['DRAFT', 'FINALIZED'] as const;
export const REVIEW_STATUSES = ['DRAFT', 'SELF_SUBMITTED', 'COMPLETED'] as const;
export const DOCUMENT_TYPES = ['ID', 'CONTRACT', 'POLICY', 'CERTIFICATE', 'OTHER'] as const;
