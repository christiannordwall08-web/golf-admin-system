# Golf Admin System – instruktioner för Claude

Två utvecklare arbetar parallellt i detta repository, båda med Claude. Läs **docs/COLLABORATION.md** innan du ändrar något
som delas (databasschema, `src/domain`, `src/server`, `src/components/ui`).

## Absoluta regler

1. **Pengar är heltal i ören**, aldrig flyttal. Använd `src/domain/money.ts`.
2. **Tid:** tidpunkter lagras som UTC (`timestamptz`), kalenderdatum som Stockholm-datum (`@db.Date`). Använd `src/domain/time.ts`.
   Räkna aldrig dag/månad med `new Date().getDate()` eller liknande.
3. **Behörighet kontrolleras på servern**, alltid: `requireRole()` i layouts/sidor, `requirePermission()` i Server Actions och
   Route Handlers, och `can(actor.role, …)` i tjänster. Att dölja en knapp är aldrig skydd. Behörighetsmatrisen finns på ett ställe:
   `src/domain/roles.ts`.
4. **Namn kommer alltid från personalregistret** (`Employee`) via relation, aldrig hårdkodade eller kopierade.
   Varje pass/registrering/rad som visas för Admin ska kunna visa vem som är ansvarig.
5. **Ansvarig person ≠ ursprunglig person.** `Shift.assignedEmployeeId` (får timmarna) skiljer sig från `Shift.originalEmployeeId`
   (oföränderlig). Ersättning följer `WorkTimeEntry.employeeId`.
6. **Skilj på** schemalagd, preliminär, godkänd och korrigerad tid. Framtida pass är aldrig genomförda eller godkända.
7. **Ändringar loggas:** skriv till `AuditLog` via `writeAudit(tx, …)` i samma transaktion som ändringen. Aldrig lösenord eller
   onödiga personuppgifter i loggen.
8. **Ingen testdata i produktion.** Testdata har `isTestData = true` och skapas bara av `prisma/seed-demo.ts`.
9. **Ändra aldrig en migration som redan finns i `main`.** Skapa en ny. Tabeller/kolumner raderas inte, de utgår.
10. Påstå inte att något fungerar förrän det är testat. Kör `npm run typecheck && npm run lint && npm test` innan du säger "klart".

## Next.js 16 är inte den Next.js du känner till

Läs relevant guide i `node_modules/next/dist/docs/` innan du skriver Next-specifik kod (se `AGENTS.md`). Några val i detta projekt:

- `cacheComponents` är **av** (se docs/ARCHITECTURE.md). All sidrendering är dynamisk.
- `middleware.ts` heter nu `proxy.ts`. Den gör bara en optimistisk kontroll, inte säkerhet.
- Lägg **aldrig** en `loading.tsx` i `src/app/` eller bredvid en layout som gör auth-kontroll (omdirigeringar blir då HTTP 200
  i stället för 307). Använd `LoadingState` i en `loading.tsx` per funktionsområde, under layouten.
- Server Actions: validera indata med Zod, hämta användaren på servern, returnera felmeddelanden på svenska.

## Mönster att följa

- Ny affärsregel → ren funktion i `src/domain/` + enhetstest i `tests/unit/`.
- Ny databasregel som Prisma inte kan uttrycka → ny migration med SQL + test i `tests/db/integrity.test.ts`.
- Ny tjänst → följ `src/server/services/pay-rates.ts`: `actor` in, behörighet först, transaktion, revisionslogg, `AppError`-fel.
- Gränssnitt → använd `src/components/ui/`. Tomt tillstånd: `EmptyState`. Fel/info: `Notice`. Laddning: `LoadingState`.
- Gränssnittstext är svenska. Kod, identifierare och commit-meddelanden är engelska eller svenska, men konsekvent per fil.

## Kommandon

`npm run typecheck` · `npm run lint` · `npm test` · `npm run db:dev` (lokal PostgreSQL) · `npm run db:migrate` · `npm run dev`
