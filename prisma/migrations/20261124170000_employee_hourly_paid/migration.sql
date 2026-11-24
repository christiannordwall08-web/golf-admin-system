-- Anställd: ingår i timlön eller inte.
-- false = ingår INTE i timlön och löneunderlag (t.ex. en administratör som styr över de anställda).
-- Befintliga anställda är timanställda (true), så ingen befintlig beräkning ändras.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "hourlyPaid" BOOLEAN NOT NULL DEFAULT true;
