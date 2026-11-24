-- Dagsavslut (summa + kommentar), fast lön, mottagare av dagsavslut och fler notistyper.
-- (Max en öppen passbytesförfrågan per pass och "inte med sig själv" finns redan i integrity_constraints.)

ALTER TYPE "NotificationType" ADD VALUE 'SWAP_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'SWAP_CANCELLED';

-- Dagsavslut: tabellen är tom (funktionen byggdes först nu), så NOT NULL utan standardvärde är säkert.
ALTER TABLE "DailyClosing" ADD COLUMN "dayTotalOre" INTEGER NOT NULL,
ADD COLUMN "note" TEXT;
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_dayTotalOre_chk" CHECK ("dayTotalOre" >= 0);

-- Fast lön hör bara ihop med "ingår inte i timlön".
ALTER TABLE "Employee" ADD COLUMN "fixedSalary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_fixedSalary_chk" CHECK (NOT "fixedSalary" OR NOT "hourlyPaid");

ALTER TABLE "User" ADD COLUMN "receivesDailyClosings" BOOLEAN NOT NULL DEFAULT false;
