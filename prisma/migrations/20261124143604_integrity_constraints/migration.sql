-- Integritetsgarantier som Prisma-schemat inte kan uttrycka. Handskriven migration.
-- Varje regel här testas i tests/db/integrity.test.ts mot en riktig PostgreSQL.
-- Ändra INTE denna fil i efterhand – skapa en ny migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Användare
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase_chk" CHECK ("email" = lower("email"));

-- ---------------------------------------------------------------------------
-- Schema och arbetspass
-- ---------------------------------------------------------------------------
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_month_chk" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "Schedule_year_chk"  CHECK ("year" BETWEEN 2000 AND 2100);

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_time_order_chk" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Shift_version_chk"    CHECK ("version" >= 1);

-- En person kan inte vara ansvarig för två överlappande pass (avbrutna pass undantas).
-- DEFERRABLE gör att ett byte mellan två personer kan göras atomiskt i en transaktion.
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_no_overlap_per_employee"
  EXCLUDE USING gist (
    "assignedEmployeeId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("workStatus" <> 'CANCELLED')
  DEFERRABLE INITIALLY IMMEDIATE;

-- Den som ursprungligen tilldelades passet får aldrig skrivas över.
CREATE FUNCTION "shift_original_assignee_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."originalEmployeeId" IS DISTINCT FROM OLD."originalEmployeeId" THEN
    RAISE EXCEPTION 'Shift.originalEmployeeId är oföränderlig'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Shift_original_assignee_immutable"
  BEFORE UPDATE ON "Shift"
  FOR EACH ROW EXECUTE FUNCTION "shift_original_assignee_immutable"();

-- ---------------------------------------------------------------------------
-- Passbytesförfrågningar
-- ---------------------------------------------------------------------------
-- Högst en öppen förfrågan per pass.
CREATE UNIQUE INDEX "ShiftSwapRequest_one_open_per_shift"
  ON "ShiftSwapRequest" ("shiftId")
  WHERE "status" IN ('AWAITING_COLLEAGUE', 'AWAITING_ADMIN');

ALTER TABLE "ShiftSwapRequest"
  ADD CONSTRAINT "ShiftSwapRequest_proposed_times_chk"
    CHECK ("proposedStartsAt" IS NULL OR "proposedEndsAt" IS NULL OR "proposedEndsAt" > "proposedStartsAt"),
  ADD CONSTRAINT "ShiftSwapRequest_not_self_chk"
    CHECK ("proposedEmployeeId" IS NULL OR "proposedEmployeeId" <> "requesterId");

-- ---------------------------------------------------------------------------
-- Timlön: perioder får inte överlappa för samma anställd
-- ---------------------------------------------------------------------------
ALTER TABLE "PayRate"
  ADD CONSTRAINT "PayRate_amount_chk" CHECK ("hourlyRateOre" >= 0),
  ADD CONSTRAINT "PayRate_period_chk" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  ADD CONSTRAINT "PayRate_no_overlap"
    EXCLUDE USING gist (
      "employeeId" WITH =,
      daterange("validFrom", "validTo", '[)') WITH &&
    );

-- ---------------------------------------------------------------------------
-- Tidsregistrering
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkTimeEntry"
  ADD CONSTRAINT "WorkTimeEntry_minutes_chk"
    CHECK ("scheduledMinutes" >= 0 AND "registeredMinutes" >= 0
           AND ("approvedMinutes" IS NULL OR "approvedMinutes" >= 0)),
  ADD CONSTRAINT "WorkTimeEntry_scheduled_order_chk"
    CHECK ("scheduledEndsAt" > "scheduledStartsAt"),
  -- Godkänd tid kräver minuter, tidpunkt och vem som godkände.
  ADD CONSTRAINT "WorkTimeEntry_approved_requires_fields_chk"
    CHECK ("status" NOT IN ('APPROVED', 'CORRECTED')
           OR ("approvedMinutes" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL));

-- Framtida pass får aldrig bli registrerad eller godkänd arbetstid.
CREATE FUNCTION "work_time_entry_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."source" = 'SCHEDULE' AND NEW."scheduledEndsAt" > now() THEN
    RAISE EXCEPTION 'WorkTimeEntry: passet har inte avslutats ännu'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IN ('APPROVED', 'CORRECTED')
     AND GREATEST(NEW."scheduledEndsAt", NEW."registeredEndsAt") > now() THEN
    RAISE EXCEPTION 'WorkTimeEntry: framtida arbetstid kan inte godkännas'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "WorkTimeEntry_guard"
  BEFORE INSERT OR UPDATE ON "WorkTimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "work_time_entry_guard"();

-- ---------------------------------------------------------------------------
-- Månadsrapporter och rader
-- ---------------------------------------------------------------------------
ALTER TABLE "MonthlyPayrollReport"
  ADD CONSTRAINT "MonthlyPayrollReport_month_chk" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "MonthlyPayrollReport_year_chk"  CHECK ("year" BETWEEN 2000 AND 2100);

ALTER TABLE "PayrollReportLine"
  ADD CONSTRAINT "PayrollReportLine_amounts_chk"
    CHECK ("approvedMinutes" >= 0 AND "hourlyRateOre" >= 0 AND "compensationOre" >= 0);

-- ---------------------------------------------------------------------------
-- Dagsavslut och notiser
-- ---------------------------------------------------------------------------
ALTER TABLE "DailyClosing"
  ADD CONSTRAINT "DailyClosing_size_chk"   CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "DailyClosing_sha256_chk" CHECK (length("sha256") = 64);

-- Notislänkar får bara vara interna sökvägar (skydd mot öppen omdirigering).
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_link_internal_chk"
    CHECK ("linkPath" IS NULL OR ("linkPath" LIKE '/%' AND "linkPath" NOT LIKE '//%'));

-- ---------------------------------------------------------------------------
-- Append-only: historik och revisionslogg kan aldrig ändras eller raderas
-- ---------------------------------------------------------------------------
CREATE FUNCTION "forbid_modification"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Standardfelkod (P0001): Prisma skickar då vidare meddelandet i stället för att
  -- översätta det till ett generiskt FK-fel.
  RAISE EXCEPTION '% är append-only: % är inte tillåtet', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
CREATE TRIGGER "ShiftAssignmentHistory_append_only"
  BEFORE UPDATE OR DELETE ON "ShiftAssignmentHistory"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
CREATE TRIGGER "ShiftApproval_append_only"
  BEFORE UPDATE OR DELETE ON "ShiftApproval"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
CREATE TRIGGER "ShiftSwapMessage_append_only"
  BEFORE UPDATE OR DELETE ON "ShiftSwapMessage"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
CREATE TRIGGER "WorkTimeCorrection_append_only"
  BEFORE UPDATE OR DELETE ON "WorkTimeCorrection"
  FOR EACH ROW EXECUTE FUNCTION "forbid_modification"();
