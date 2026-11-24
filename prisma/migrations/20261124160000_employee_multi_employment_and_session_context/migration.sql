-- Två inloggningar (Admin / Anställd) och flera anställningar per person.
--  * Session.context: vilken inloggning sessionen kommer från (styr vilken panel som får användas).
--  * Employee: en användare kan ha en anställning per arbetskategori (t.ex. både Golfshop och Bollplockare),
--    så unikheten flyttas från userId till (userId, category).

-- CreateEnum
CREATE TYPE "SessionContext" AS ENUM ('ADMIN', 'EMPLOYEE');

-- DropIndex
DROP INDEX "Employee_userId_key";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "context" "SessionContext" NOT NULL DEFAULT 'EMPLOYEE';

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_category_key" ON "Employee"("userId", "category");
