-- Lediga pass (OpenShift), intresseanmälningar (OpenShiftClaim) och schemainställningar (SchedulingSettings).
-- Additiv: inga kolumner eller tabeller tas bort. Sista delen är handskrivna regler som Prisma inte kan uttrycka
-- (testas i tests/db/open-shifts.test.ts).

-- CreateEnum
CREATE TYPE "OpenShiftStatus" AS ENUM ('OPEN', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpenShiftClaimStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "AssignmentChangeReason" ADD VALUE 'OPEN_SHIFT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'OPEN_SHIFT_POSTED';
ALTER TYPE "NotificationType" ADD VALUE 'OPEN_SHIFT_CLAIMED';
ALTER TYPE "NotificationType" ADD VALUE 'OPEN_SHIFT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'OPEN_SHIFT_NOT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'OPEN_SHIFT_CANCELLED';

-- CreateTable
CREATE TABLE "OpenShift" (
    "id" TEXT NOT NULL,
    "category" "WorkCategory" NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "openEnded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "OpenShiftStatus" NOT NULL DEFAULT 'OPEN',
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "filledShiftId" TEXT,
    "filledAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OpenShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenShiftClaim" (
    "id" TEXT NOT NULL,
    "openShiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "OpenShiftClaimStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,

    CONSTRAINT "OpenShiftClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autoApproveSwaps" BOOLEAN NOT NULL DEFAULT false,
    "openShiftAutoAssignDefault" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SchedulingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenShift_filledShiftId_key" ON "OpenShift"("filledShiftId");

-- CreateIndex
CREATE INDEX "OpenShift_category_status_startsAt_idx" ON "OpenShift"("category", "status", "startsAt");

-- CreateIndex
CREATE INDEX "OpenShiftClaim_employeeId_status_idx" ON "OpenShiftClaim"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenShiftClaim_openShiftId_employeeId_key" ON "OpenShiftClaim"("openShiftId", "employeeId");

-- AddForeignKey
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_filledShiftId_fkey" FOREIGN KEY ("filledShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_openShiftId_fkey" FOREIGN KEY ("openShiftId") REFERENCES "OpenShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingSettings" ADD CONSTRAINT "SchedulingSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Handskrivna integritetsregler (Prisma kan inte uttrycka dem)
-- =============================================================================

-- Slut efter start.
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_times_check" CHECK ("endsAt" > "startsAt");

-- Status och fält hänger ihop: tillsatt ⇔ har pass och tidpunkt, indraget ⇔ har tidpunkt. Ett öppet pass har inget av dem.
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_status_fields_check" CHECK (
  ("status" = 'FILLED') = ("filledShiftId" IS NOT NULL AND "filledAt" IS NOT NULL)
  AND ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
);

-- Högst en antagen anmälan per ledigt pass. Exclusion constraint (inte ett partiellt index) så att Prisma inte ser det som
-- avvikelse från schemat, samma mönster som överlappsskyddet på Shift.
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_one_accepted_per_open_shift"
  EXCLUDE USING btree ("openShiftId" WITH =) WHERE ("status" = 'ACCEPTED');

-- Ett avgjort beslut har en tidpunkt.
ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_decided_check" CHECK (
  "status" IN ('PENDING', 'WITHDRAWN') OR "decidedAt" IS NOT NULL
);

-- Inställningarna är en enda rad.
ALTER TABLE "SchedulingSettings" ADD CONSTRAINT "SchedulingSettings_single_row" CHECK ("id" = 'default');
