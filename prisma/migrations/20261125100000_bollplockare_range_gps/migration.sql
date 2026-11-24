-- Bollplockare: driving range, arbetsområde (geofence), GPS-tillstånd, pauser, historik, passbytestyper.
-- Additiv: inga kolumner eller tabeller tas bort. Delar av filen är handskrivna regler som Prisma inte kan uttrycka
-- (testas i tests/db/bollplockare-integrity.test.ts).


-- CreateEnum
CREATE TYPE "BollplockareGpsStatus" AS ENUM ('NONE', 'INSIDE', 'MARGIN', 'VERIFYING', 'OUTSIDE', 'UNRELIABLE', 'MISSING', 'DENIED');

-- CreateEnum
CREATE TYPE "GpsPauseEnd" AS ENUM ('RETURNED', 'CLOCKED_OUT', 'ADMIN');

-- CreateEnum
CREATE TYPE "GpsEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'PAUSE_STARTED', 'PAUSE_ENDED', 'GPS_UNRELIABLE', 'GPS_MISSING', 'GPS_DENIED', 'GPS_RESTORED', 'CLOCK_OUT_REMINDER', 'ADMIN_CORRECTION', 'PAUSE_VOIDED');

-- CreateEnum
CREATE TYPE "SwapKind" AS ENUM ('DIRECT', 'OPEN', 'EXCHANGE', 'CHANGE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WORK_CLOCKED_IN';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_CLOCKED_OUT';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_PAUSED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_RESUMED';
ALTER TYPE "NotificationType" ADD VALUE 'GPS_UNVERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'CLOCK_OUT_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'NO_SHOW';
ALTER TYPE "NotificationType" ADD VALUE 'WORKTIME_CORRECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_REMINDER';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "openEnded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShiftSwapRequest" ADD COLUMN     "counterShiftId" TEXT,
ADD COLUMN     "kind" "SwapKind" NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "WorkTimeCorrection" ADD COLUMN     "detail" JSONB;

-- CreateTable
CREATE TABLE "BollplockareSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultCloseTime" TEXT NOT NULL DEFAULT '20:00',
    "checkInMarginMinutes" INTEGER NOT NULL DEFAULT 20,
    "verificationSeconds" INTEGER NOT NULL DEFAULT 30,
    "maxAccuracyMeters" INTEGER NOT NULL DEFAULT 50,
    "staleAfterSeconds" INTEGER NOT NULL DEFAULT 120,
    "returnHysteresisMeters" INTEGER NOT NULL DEFAULT 10,
    "gpsRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "clockOutReminderMinutes" INTEGER NOT NULL DEFAULT 240,
    "noShowAfterMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BollplockareSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BollplockareDayOverride" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closeTime" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BollplockareDayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsWorkArea" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Golfanläggningen',
    "polygons" JSONB NOT NULL DEFAULT '[]',
    "marginMeters" INTEGER NOT NULL DEFAULT 40,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GpsWorkArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BollplockareSession" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "gpsStatus" "BollplockareGpsStatus" NOT NULL DEFAULT 'NONE',
    "gpsStatusAt" TIMESTAMPTZ(3),
    "lastPositionAt" TIMESTAMPTZ(3),
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastAccuracyM" DOUBLE PRECISION,
    "lastDistanceM" DOUBLE PRECISION,
    "trackSince" TIMESTAMPTZ(3),
    "trackSamples" INTEGER NOT NULL DEFAULT 0,
    "pausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReasons" TEXT[],
    "clockOutReminderSentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BollplockareSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsPause" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "endedBy" "GpsPauseEnd",
    "distanceM" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "GpsEventType" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,
    "actorId" TEXT,

    CONSTRAINT "GpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BollplockareDayOverride_date_key" ON "BollplockareDayOverride"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BollplockareSession_entryId_key" ON "BollplockareSession"("entryId");

-- CreateIndex
CREATE INDEX "GpsPause_sessionId_startedAt_idx" ON "GpsPause"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "GpsEvent_sessionId_at_idx" ON "GpsEvent"("sessionId", "at");

-- AddForeignKey
ALTER TABLE "BollplockareSettings" ADD CONSTRAINT "BollplockareSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BollplockareDayOverride" ADD CONSTRAINT "BollplockareDayOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsWorkArea" ADD CONSTRAINT "GpsWorkArea_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BollplockareSession" ADD CONSTRAINT "BollplockareSession_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WorkTimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPause" ADD CONSTRAINT "GpsPause_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BollplockareSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPause" ADD CONSTRAINT "GpsPause_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BollplockareSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsEvent" ADD CONSTRAINT "GpsEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_counterShiftId_fkey" FOREIGN KEY ("counterShiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Handskrivna regler
-- ---------------------------------------------------------------------------

ALTER TABLE "BollplockareSettings"
  ADD CONSTRAINT "BollplockareSettings_singleton_chk" CHECK ("id" = 'default'),
  ADD CONSTRAINT "BollplockareSettings_close_time_chk" CHECK ("defaultCloseTime" ~ '^(0[6-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "BollplockareSettings_ranges_chk" CHECK (
    "checkInMarginMinutes" BETWEEN 0 AND 180
    AND "verificationSeconds" BETWEEN 5 AND 600
    AND "maxAccuracyMeters" BETWEEN 5 AND 500
    AND "staleAfterSeconds" BETWEEN 30 AND 3600
    AND "returnHysteresisMeters" BETWEEN 0 AND 100
    AND "gpsRetentionDays" BETWEEN 1 AND 365
    AND "clockOutReminderMinutes" BETWEEN 30 AND 1440
    AND "noShowAfterMinutes" BETWEEN 5 AND 480);

-- Avvikande stängningstid ELLER stängd dag.
ALTER TABLE "BollplockareDayOverride"
  ADD CONSTRAINT "BollplockareDayOverride_close_chk" CHECK (
    ("isClosed" AND "closeTime" IS NULL)
    OR (NOT "isClosed" AND "closeTime" ~ '^(0[6-9]|1[0-9]|2[0-3]):[0-5][0-9]$'));

ALTER TABLE "GpsWorkArea"
  ADD CONSTRAINT "GpsWorkArea_singleton_chk" CHECK ("id" = 'default'),
  ADD CONSTRAINT "GpsWorkArea_margin_chk" CHECK ("marginMeters" BETWEEN 0 AND 500),
  ADD CONSTRAINT "GpsWorkArea_polygons_chk" CHECK (jsonb_typeof("polygons") = 'array');

-- Pass utan fast sluttid finns bara för bollplockare.
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_open_ended_category_chk" CHECK (NOT "openEnded" OR "category" = 'BOLLPLOCKARE');

-- Passbytestyper: rätt fält för respektive typ.
ALTER TABLE "ShiftSwapRequest"
  ADD CONSTRAINT "ShiftSwapRequest_kind_chk" CHECK (
    ("kind" = 'EXCHANGE') = ("counterShiftId" IS NOT NULL)
    AND ("kind" <> 'EXCHANGE' OR "proposedEmployeeId" IS NOT NULL)
    AND ("kind" <> 'DIRECT' OR "proposedEmployeeId" IS NOT NULL)
    AND ("kind" NOT IN ('OPEN', 'CHANGE') OR "status" <> 'AWAITING_COLLEAGUE' OR "proposedEmployeeId" IS NULL OR "kind" = 'OPEN'));
-- Motpartens pass kan inte ingå i två öppna förfrågningar samtidigt.
CREATE UNIQUE INDEX "ShiftSwapRequest_one_open_per_counter_shift"
  ON "ShiftSwapRequest" ("counterShiftId")
  WHERE "counterShiftId" IS NOT NULL AND "status" IN ('AWAITING_COLLEAGUE', 'AWAITING_ADMIN');

-- Tidsregistrering: utcheckning kan inte ligga före incheckning, och en person kan bara ha EN pågående GPS-registrering
-- (skyddar mot dubbel incheckning från flera flikar eller enheter).
ALTER TABLE "WorkTimeEntry"
  ADD CONSTRAINT "WorkTimeEntry_registered_order_chk"
    CHECK ("registeredEndsAt" IS NULL OR "registeredStartsAt" IS NULL OR "registeredEndsAt" >= "registeredStartsAt");
CREATE UNIQUE INDEX "WorkTimeEntry_one_open_gps_per_employee"
  ON "WorkTimeEntry" ("employeeId")
  WHERE "source" = 'GPS' AND "registeredEndsAt" IS NULL;

ALTER TABLE "BollplockareSession"
  ADD CONSTRAINT "BollplockareSession_values_chk" CHECK (
    "pausedMinutes" >= 0 AND "trackSamples" >= 0
    AND ("lastLat" IS NULL OR "lastLat" BETWEEN -90 AND 90)
    AND ("lastLng" IS NULL OR "lastLng" BETWEEN -180 AND 180));

-- Pauser: slut efter start, högst en öppen per pass, och inga överlappande (ogiltigförklarade undantas).
ALTER TABLE "GpsPause"
  ADD CONSTRAINT "GpsPause_order_chk" CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt"),
  ADD CONSTRAINT "GpsPause_void_chk" CHECK (("voidedAt" IS NULL) = ("voidedById" IS NULL)),
  ADD CONSTRAINT "GpsPause_no_overlap"
    EXCLUDE USING gist ("sessionId" WITH =, tstzrange("startedAt", "endedAt", '[)') WITH &&) WHERE ("voidedAt" IS NULL);
CREATE UNIQUE INDEX "GpsPause_one_open_per_session"
  ON "GpsPause" ("sessionId")
  WHERE "endedAt" IS NULL AND "voidedAt" IS NULL;

-- Passets historik kan aldrig ändras eller raderas.
CREATE TRIGGER "GpsEvent_append_only"
  BEFORE UPDATE OR DELETE ON "GpsEvent"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
