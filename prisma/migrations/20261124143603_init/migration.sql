-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'GOLFSHOP', 'BOLLPLOCKARE');

-- CreateEnum
CREATE TYPE "WorkCategory" AS ENUM ('GOLFSHOP', 'BOLLPLOCKARE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGE_REQUESTED', 'APPROVED_AFTER_SWAP');

-- CreateEnum
CREATE TYPE "ShiftWorkStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'ABSENT');

-- CreateEnum
CREATE TYPE "AssignmentChangeReason" AS ENUM ('INITIAL', 'ADMIN_REASSIGNMENT', 'SHIFT_SWAP');

-- CreateEnum
CREATE TYPE "SwapRequestStatus" AS ENUM ('AWAITING_COLLEAGUE', 'AWAITING_ADMIN', 'DECLINED_BY_COLLEAGUE', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkTimeSource" AS ENUM ('SCHEDULE', 'GPS', 'ADMIN_MANUAL');

-- CreateEnum
CREATE TYPE "WorkTimeStatus" AS ENUM ('PRELIMINARY', 'APPROVED', 'CORRECTED', 'ABSENT', 'VOID');

-- CreateEnum
CREATE TYPE "PayrollReportStatus" AS ENUM ('DRAFT', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "DailyClosingStatus" AS ENUM ('SUBMITTED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCHEDULE_PUBLISHED', 'SHIFT_APPROVAL_NEEDED', 'SHIFT_CHANGED', 'SHIFT_UPCOMING', 'SWAP_REQUESTED', 'SWAP_COLLEAGUE_ACCEPTED', 'SWAP_COLLEAGUE_DECLINED', 'SWAP_APPROVED', 'SWAP_DENIED', 'DAILY_CLOSING_SUBMITTED', 'DAILY_CLOSING_MISSING', 'WORKTIME_NEEDS_REVIEW', 'PAYROLL_REPORT_READY');

-- CreateTable
CREATE TABLE "DailyClosing" (
    "id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "uploadedByEmployeeId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'SUBMITTED',
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" TEXT,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyClosingAssignment" (
    "id" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "responsibleEmployeeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyClosingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "phone" TEXT,
    "employmentStartDate" DATE,
    "employmentEndDate" DATE,
    "showEarningsToEmployee" BOOLEAN NOT NULL DEFAULT false,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulePublication" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftCount" INTEGER NOT NULL,
    "employeesNotified" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "SchedulePublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "assignedEmployeeId" TEXT NOT NULL,
    "originalEmployeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "workStatus" "ShiftWorkStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignmentHistory" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "fromEmployeeId" TEXT,
    "toEmployeeId" TEXT NOT NULL,
    "reason" "AssignmentChangeReason" NOT NULL,
    "swapRequestId" TEXT,
    "changedById" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftApproval" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftVersion" INTEGER NOT NULL,
    "decision" "ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "proposedEmployeeId" TEXT,
    "proposedStartsAt" TIMESTAMPTZ(3),
    "proposedEndsAt" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "status" "SwapRequestStatus" NOT NULL DEFAULT 'AWAITING_COLLEAGUE',
    "shiftVersionAtRequest" INTEGER NOT NULL,
    "colleagueRespondedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "adminComment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftSwapMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkPath" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hourlyRateOre" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTimeEntry" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "source" "WorkTimeSource" NOT NULL,
    "status" "WorkTimeStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "scheduledStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledMinutes" INTEGER NOT NULL,
    "registeredStartsAt" TIMESTAMPTZ(3),
    "registeredEndsAt" TIMESTAMPTZ(3),
    "registeredMinutes" INTEGER NOT NULL,
    "approvedMinutes" INTEGER,
    "payRateId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTimeCorrection" (
    "id" TEXT NOT NULL,
    "workTimeEntryId" TEXT NOT NULL,
    "previousApprovedMinutes" INTEGER,
    "newApprovedMinutes" INTEGER,
    "previousStatus" "WorkTimeStatus" NOT NULL,
    "newStatus" "WorkTimeStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkTimeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPayrollReport" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollReportStatus" NOT NULL DEFAULT 'DRAFT',
    "totalApprovedMinutes" INTEGER,
    "totalCompensationOre" BIGINT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MonthlyPayrollReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReportLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "workTimeEntryId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "workDate" DATE NOT NULL,
    "scheduledStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledMinutes" INTEGER NOT NULL,
    "approvedMinutes" INTEGER NOT NULL,
    "hourlyRateOre" INTEGER NOT NULL,
    "compensationOre" INTEGER NOT NULL,
    "originalEmployeeName" TEXT,

    CONSTRAINT "PayrollReportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workTimeEntryId" TEXT,
    "minutesDelta" INTEGER NOT NULL,
    "amountDeltaOre" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_storageKey_key" ON "DailyClosing"("storageKey");

-- CreateIndex
CREATE INDEX "DailyClosing_workDate_idx" ON "DailyClosing"("workDate");

-- CreateIndex
CREATE INDEX "DailyClosing_uploadedByEmployeeId_workDate_idx" ON "DailyClosing"("uploadedByEmployeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosingAssignment_workDate_key" ON "DailyClosingAssignment"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_category_status_idx" ON "Employee"("category", "status");

-- CreateIndex
CREATE INDEX "Employee_lastName_firstName_idx" ON "Employee"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_category_year_month_key" ON "Schedule"("category", "year", "month");

-- CreateIndex
CREATE INDEX "SchedulePublication_scheduleId_publishedAt_idx" ON "SchedulePublication"("scheduleId", "publishedAt");

-- CreateIndex
CREATE INDEX "Shift_assignedEmployeeId_startsAt_idx" ON "Shift"("assignedEmployeeId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_category_localDate_idx" ON "Shift"("category", "localDate");

-- CreateIndex
CREATE INDEX "Shift_scheduleId_idx" ON "Shift"("scheduleId");

-- CreateIndex
CREATE INDEX "ShiftAssignmentHistory_shiftId_createdAt_idx" ON "ShiftAssignmentHistory"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftApproval_shiftId_decidedAt_idx" ON "ShiftApproval"("shiftId", "decidedAt");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_shiftId_idx" ON "ShiftSwapRequest"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_status_createdAt_idx" ON "ShiftSwapRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftSwapMessage_requestId_createdAt_idx" ON "ShiftSwapMessage"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PayRate_employeeId_validFrom_idx" ON "PayRate"("employeeId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTimeEntry_shiftId_key" ON "WorkTimeEntry"("shiftId");

-- CreateIndex
CREATE INDEX "WorkTimeEntry_employeeId_workDate_idx" ON "WorkTimeEntry"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "WorkTimeEntry_workDate_category_idx" ON "WorkTimeEntry"("workDate", "category");

-- CreateIndex
CREATE INDEX "WorkTimeEntry_status_idx" ON "WorkTimeEntry"("status");

-- CreateIndex
CREATE INDEX "WorkTimeCorrection_workTimeEntryId_createdAt_idx" ON "WorkTimeCorrection"("workTimeEntryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPayrollReport_year_month_key" ON "MonthlyPayrollReport"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollReportLine_workTimeEntryId_key" ON "PayrollReportLine"("workTimeEntryId");

-- CreateIndex
CREATE INDEX "PayrollReportLine_reportId_workDate_idx" ON "PayrollReportLine"("reportId", "workDate");

-- CreateIndex
CREATE INDEX "PayrollReportLine_employeeId_idx" ON "PayrollReportLine"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_reportId_idx" ON "PayrollAdjustment"("reportId");

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosingAssignment" ADD CONSTRAINT "DailyClosingAssignment_responsibleEmployeeId_fkey" FOREIGN KEY ("responsibleEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosingAssignment" ADD CONSTRAINT "DailyClosingAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePublication" ADD CONSTRAINT "SchedulePublication_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePublication" ADD CONSTRAINT "SchedulePublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_originalEmployeeId_fkey" FOREIGN KEY ("originalEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_swapRequestId_fkey" FOREIGN KEY ("swapRequestId") REFERENCES "ShiftSwapRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignmentHistory" ADD CONSTRAINT "ShiftAssignmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftApproval" ADD CONSTRAINT "ShiftApproval_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftApproval" ADD CONSTRAINT "ShiftApproval_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_proposedEmployeeId_fkey" FOREIGN KEY ("proposedEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapMessage" ADD CONSTRAINT "ShiftSwapMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ShiftSwapRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapMessage" ADD CONSTRAINT "ShiftSwapMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRate" ADD CONSTRAINT "PayRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_payRateId_fkey" FOREIGN KEY ("payRateId") REFERENCES "PayRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeCorrection" ADD CONSTRAINT "WorkTimeCorrection_workTimeEntryId_fkey" FOREIGN KEY ("workTimeEntryId") REFERENCES "WorkTimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeCorrection" ADD CONSTRAINT "WorkTimeCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayrollReport" ADD CONSTRAINT "MonthlyPayrollReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayrollReport" ADD CONSTRAINT "MonthlyPayrollReport_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportLine" ADD CONSTRAINT "PayrollReportLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MonthlyPayrollReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportLine" ADD CONSTRAINT "PayrollReportLine_workTimeEntryId_fkey" FOREIGN KEY ("workTimeEntryId") REFERENCES "WorkTimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportLine" ADD CONSTRAINT "PayrollReportLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MonthlyPayrollReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
