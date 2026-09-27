-- Production hardening migration.
-- Additive only: no columns holding customer data are dropped (Payslip.pdfUrl held placeholder URLs).
-- Float -> DECIMAL casts are lossless for currency values with <= 2 decimals.
-- NOTE: the unique index on Application(jobId, candidateEmail) fails if duplicate applications exist;
-- resolve duplicates manually before deploying if that happens.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "demoSeededAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slackHiringWebhookEnc" TEXT,
ADD COLUMN     "slackWebhookUrlEnc" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "dateOfJoining" DATE,
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "employeeCode" TEXT,
ADD COLUMN     "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "exitDate" DATE,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "aiScoredAt" TIMESTAMP(3),
ADD COLUMN     "interviewAt" TIMESTAMP(3),
ADD COLUMN     "interviewerEmail" TEXT,
ADD COLUMN     "resumeKey" TEXT,
ADD COLUMN     "resumeMimeType" TEXT,
ADD COLUMN     "tenantId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'APPLIED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "error" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "workMinutes" INTEGER;

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN     "monthlyTds" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pfEnabled" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "baseSalary" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "allowances" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deductions" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Payslip" DROP COLUMN "pdfUrl",
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lopDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "payableDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "pfDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tdsDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "basicPay" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "allowances" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deductions" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "netPay" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "fileUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PerformanceReview" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "managerComments" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "annualQuota" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_tenantId_type_key" ON "LeavePolicy"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_tenantId_date_key" ON "Holiday"("tenantId", "date");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Employee_tenantId_status_idx" ON "Employee"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_employeeCode_key" ON "Employee"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "Job_tenantId_status_idx" ON "Job"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Application_tenantId_status_idx" ON "Application"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_candidateEmail_key" ON "Application"("jobId", "candidateEmail");

-- CreateIndex
CREATE INDEX "Notification_tenantId_recipientUserId_idx" ON "Notification"("tenantId", "recipientUserId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenantId_date_idx" ON "AttendanceRecord"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Payslip_tenantId_year_month_idx" ON "Payslip"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "Document_tenantId_expiryDate_idx" ON "Document"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerId_idx" ON "PerformanceReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReview_tenantId_employeeId_cycleName_key" ON "PerformanceReview"("tenantId", "employeeId", "cycleName");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: applications inherit the tenant of their job, then the column becomes mandatory.
UPDATE "Application" a SET "tenantId" = j."tenantId" FROM "Job" j WHERE a."jobId" = j."id";
ALTER TABLE "Application" ALTER COLUMN "tenantId" SET NOT NULL;
UPDATE "Application" SET "status" = 'APPLIED' WHERE "status" = 'PENDING';

-- Backfill: payslip lifecycle is now DRAFT -> FINALIZED; gross = basic + allowances for legacy rows.
UPDATE "Payslip" SET "status" = CASE WHEN "status" = 'PAID' THEN 'FINALIZED' ELSE 'DRAFT' END;
UPDATE "Payslip" SET "grossPay" = "basicPay" + "allowances", "finalizedAt" = CASE WHEN "status" = 'FINALIZED' THEN "createdAt" END;

-- Backfill: legacy leave rows get calendar-day length (new rows store working days).
UPDATE "LeaveRequest" SET "days" = GREATEST(1, ("endDate"::date - "startDate"::date) + 1);
