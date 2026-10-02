# Audit trail

`apps/server/src/common/audit`

Two sources write to `AuditLog(tenantId, userId, action, resource, resourceId, oldValues,
newValues, ipAddress, userAgent, requestId, createdAt)`:

1. **`AuditInterceptor`** (global) — every *successful* `POST/PUT/PATCH/DELETE` by an
   authenticated user: `action = "PATCH /employees/:id"`, resource, id, IP, user agent,
   request id. Request **bodies are never stored** (passwords, salaries, personal data).
2. **Explicit business events** with before/after values: `SIGNUP`, `LOGIN`, `LOGIN_FAILED`,
   `ACCOUNT_LOCKED`, `REFRESH_TOKEN_REUSE`, `INVITE_ACCEPTED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`, `2FA_*`, `INVITE`, `ROLE_CHANGED`,
   `EMPLOYEE_UPDATED`, `EMPLOYEE_OFFBOARDED`, `SALARY_CREATED/UPDATED`, `PAYROLL_GENERATED`,
   `PAYROLL_FINALIZED`, `LEAVE_APPROVED/REJECTED`, `APPLICATION_STATUS`, `SETTINGS_UPDATED`,
   `SUBSCRIPTION_SYNC`, `DATA_EXPORT`, `EMPLOYEE_ERASED`, `CANDIDATE_ERASED`,
   `TENANT_SUSPENDED/REACTIVATED`.

Audit writes never fail the user's request (errors are logged). `GET /audit?resource&userId&page`
requires `audit.read` and is tenant-scoped. The table is append-only from the application's point of view
(no update/delete code paths). For tamper-evidence, ship logs to write-once storage (e.g. S3
Object Lock) — see roadmap.
