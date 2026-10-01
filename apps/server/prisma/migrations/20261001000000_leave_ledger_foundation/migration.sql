-- Production-grade leave foundation. Additive migration: existing requests
-- remain valid and are lazily represented in the immutable balance ledger the
-- first time an employee/policy/year is changed.

ALTER TABLE "LeavePolicy"
  ADD COLUMN "accrualMode" TEXT NOT NULL DEFAULT 'ANNUAL_GRANT',
  ADD COLUMN "carryForwardLimit" DECIMAL(8,2),
  ADD COLUMN "allowNegative" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "effectiveFrom" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "effectiveTo" DATE;

ALTER TABLE "LeaveRequest"
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "policySnapshot" JSONB,
  ADD COLUMN "approvalSnapshot" JSONB;

CREATE UNIQUE INDEX "LeaveRequest_tenantId_requestKey_key"
  ON "LeaveRequest"("tenantId", "requestKey");

CREATE TABLE "LeaveBalanceLedger" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveRequestId" TEXT,
  "type" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "event" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "days" DECIMAL(8,2) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveBalanceLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveBalanceLedger_tenantId_employeeId_type_year_eventKey_key"
  ON "LeaveBalanceLedger"("tenantId", "employeeId", "type", "year", "eventKey");
CREATE INDEX "LeaveBalanceLedger_tenantId_employeeId_type_year_idx"
  ON "LeaveBalanceLedger"("tenantId", "employeeId", "type", "year");
CREATE INDEX "LeaveBalanceLedger_leaveRequestId_idx" ON "LeaveBalanceLedger"("leaveRequestId");

CREATE TABLE "LeaveApproval" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "step" INTEGER NOT NULL DEFAULT 1,
  "approverId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "note" TEXT,
  "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveApproval_leaveRequestId_step_key" ON "LeaveApproval"("leaveRequestId", "step");
CREATE INDEX "LeaveApproval_tenantId_leaveRequestId_idx" ON "LeaveApproval"("tenantId", "leaveRequestId");

CREATE TABLE "LeavePolicyVersion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "leavePolicyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "annualQuota" INTEGER NOT NULL,
  "isPaid" BOOLEAN NOT NULL,
  "accrualMode" TEXT NOT NULL,
  "carryForwardLimit" DECIMAL(8,2),
  "allowNegative" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeavePolicyVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeavePolicyVersion_leavePolicyId_version_key" ON "LeavePolicyVersion"("leavePolicyId", "version");
CREATE INDEX "LeavePolicyVersion_tenantId_leavePolicyId_effectiveFrom_idx" ON "LeavePolicyVersion"("tenantId", "leavePolicyId", "effectiveFrom");

INSERT INTO "LeavePolicyVersion" (
  "id", "tenantId", "leavePolicyId", "version", "annualQuota", "isPaid", "accrualMode",
  "carryForwardLimit", "allowNegative", "effectiveFrom", "effectiveTo"
)
SELECT "id", "tenantId", "id", 1, "annualQuota", "isPaid", "accrualMode",
  "carryForwardLimit", "allowNegative", "effectiveFrom", "effectiveTo"
FROM "LeavePolicy";

CREATE TABLE "LeaveApprovalRule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "approverKind" TEXT NOT NULL,
  "approverRole" TEXT,
  "approverUserId" TEXT,
  "reminderAfterHours" INTEGER NOT NULL DEFAULT 24,
  "escalationAfterHours" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveApprovalRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveApprovalRule_tenantId_type_step_key" ON "LeaveApprovalRule"("tenantId", "type", "step");
CREATE INDEX "LeaveApprovalRule_tenantId_type_isActive_idx" ON "LeaveApprovalRule"("tenantId", "type", "isActive");

CREATE TABLE "LeaveApprovalDelegation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "delegatorId" TEXT NOT NULL,
  "delegateId" TEXT NOT NULL,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveApprovalDelegation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveApprovalDelegation_tenantId_delegatorId_delegateId_startsAt_key" ON "LeaveApprovalDelegation"("tenantId", "delegatorId", "delegateId", "startsAt");
CREATE INDEX "LeaveApprovalDelegation_tenantId_delegateId_startsAt_idx" ON "LeaveApprovalDelegation"("tenantId", "delegateId", "startsAt");

CREATE TABLE "LeaveApprovalFollowUp" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveApprovalFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveApprovalFollowUp_leaveRequestId_step_kind_key" ON "LeaveApprovalFollowUp"("leaveRequestId", "step", "kind");
CREATE INDEX "LeaveApprovalFollowUp_tenantId_createdAt_idx" ON "LeaveApprovalFollowUp"("tenantId", "createdAt");

ALTER TABLE "LeaveBalanceLedger" ADD CONSTRAINT "LeaveBalanceLedger_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveBalanceLedger" ADD CONSTRAINT "LeaveBalanceLedger_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveBalanceLedger" ADD CONSTRAINT "LeaveBalanceLedger_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeavePolicyVersion" ADD CONSTRAINT "LeavePolicyVersion_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeavePolicyVersion" ADD CONSTRAINT "LeavePolicyVersion_leavePolicyId_fkey"
  FOREIGN KEY ("leavePolicyId") REFERENCES "LeavePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalRule" ADD CONSTRAINT "LeaveApprovalRule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalDelegation" ADD CONSTRAINT "LeaveApprovalDelegation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalDelegation" ADD CONSTRAINT "LeaveApprovalDelegation_delegatorId_fkey"
  FOREIGN KEY ("delegatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalDelegation" ADD CONSTRAINT "LeaveApprovalDelegation_delegateId_fkey"
  FOREIGN KEY ("delegateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalFollowUp" ADD CONSTRAINT "LeaveApprovalFollowUp_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveApprovalFollowUp" ADD CONSTRAINT "LeaveApprovalFollowUp_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
