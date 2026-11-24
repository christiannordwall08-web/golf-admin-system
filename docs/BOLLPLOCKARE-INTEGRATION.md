# Integration med Bollplockare

> **Status:** bollplockarmodulen (schemaläggning utan fast sluttid, klocka in/ut, GPS-geofencing med säkerhetsmarginal, pauser, notiser,
> passbyten, rapporter och CSV) är implementerad. Se **[BOLLPLOCKARE-GPS.md](./BOLLPLOCKARE-GPS.md)** för hur den fungerar, begränsningar och integritet.
> Förslaget nedan beskriver det ursprungliga gränssnittet och gäller fortfarande för `WorkTimeEntry`.
>
> **Delade filer som ändrats för den (granska innan merge, se COLLABORATION.md):** `prisma/schema/{people,scheduling,time-pay,enums,bollplockare}.prisma`
> (additivt: `Shift.openEnded`, `ShiftSwapRequest.kind/counterShiftId`, `WorkTimeCorrection.detail`, nya enum-värden, nya `Bollplockare*`/`Gps*`-modeller),
> migrationerna `20261125100000…`–`20261125120000…` (inkl. en ny version av triggerfunktionen `work_time_entry_guard`),
> `src/domain/{roles,hours}.ts` (nya behörigheterna `worktime:clock` och `range:configure`), `src/server/services/{shifts,notifications}.ts`,
> `src/server/queries/*`, `src/components/layout/*`, `src/components/schedule/*`, samt `src/app/bollplockare/**` och `src/modules/bollplockare/**`.

Bollplockarnas GPS-baserade in-/utcheckning och tidsregistrering byggs av Bollplockare-utvecklaren. Admin hanterar redan nu
bollplockarna i samma system. Det här dokumentet är **förslaget till gränssnitt** mellan de två delarna; justera det tillsammans innan något byggs.

## Vad som redan finns och kan användas direkt

| Behov | Så här |
|---|---|
| Inloggning och roll | `requireEmployeeArea("BOLLPLOCKARE")` i layout och sidor (kräver en Anställd-session och en aktiv anställning i Bollplockare), `requirePermission(...)` i actions/handlers. Se `src/components/employee/` och `src/server/auth/current-user.ts`. |
| Vem är inloggad | `requireEmployeeArea("BOLLPLOCKARE")` ger `employee.id` (din anställning i personalregistret). `session.user.displayName` är namnet. Namn kommer alltid från `Employee`. En person kan ha anställning i både Golfshop och Bollplockare. |
| Personalregister och scheman | Admin skapar bollplockare (`Employee.category = BOLLPLOCKARE`) och pass i Schema B (`Schedule.category = BOLLPLOCKARE`). |
| Mina pass | `db.shift.findMany({ where: { assignedEmployeeId: employee.id, category: "BOLLPLOCKARE", publicationStatus: "PUBLISHED" } })` |
| Timlön | Hanteras av Admin (`PayRate`). Bollplockare-koden läser eller räknar aldrig lön. |
| Designsystem | `src/components/ui/**` och `AppShell`. |
| Roll- och namnkontroll, tid, pengar | `src/domain/**` |
| Hjälpfunktioner för test | `tests/db/helpers.ts` (`makeEmployee`, `makeShift`, …) och `npm run db:seed:demo` (Oscar Nilsson och Emma Karlsson är bollplockare). |

## Era filer

- `prisma/schema/bollplockare.prisma`: modeller för GPS-händelser, positioner, avvikelser. Prefix `Gps*`/`Bollplockare*`. Referera till `Employee`/`Shift` med `id` och `onDelete: Restrict`.
- `src/modules/bollplockare/**`: er logik. `src/app/bollplockare/**`: era sidor. `nav-config.ts` → `NAV_BY_ROLE.BOLLPLOCKARE`: er meny.

## Hur tid når Admin och lönen

All lönegrundande tid går genom **`WorkTimeEntry`**, så att Admin, månadsrapporter och löneberäkning fungerar likadant för båda grupperna.

1. Vid **incheckning** skapas (eller hittas) `WorkTimeEntry` för passet: `source = GPS`, `status = PRELIMINARY`, `employeeId` = den som checkar in,
   `registeredStartsAt = incheckningstid`, `registeredMinutes = 0`, `scheduledStartsAt/EndsAt/Minutes` från passet.
   Databasen tillåter detta även före passets slut (spärren mot framtida poster gäller bara `source = SCHEDULE`).
2. Vid **utcheckning** sätts `registeredEndsAt` och `registeredMinutes` (hela minuter, `minutesBetween` i `src/domain/time.ts`).
3. **Ni sätter aldrig** `approvedMinutes`, `approvedAt`, `approvedById`, `payRateId` eller status `APPROVED/CORRECTED`. Det gör bara Admin.
   Databasen nekar godkänd tid för pass som inte avslutats och kräver att godkända poster har minuter, tidpunkt och godkännare.
4. Automatisk schemabaserad tidsregistrering (Etapp 4) gäller **bara Golfshop**. Bollplockare registreras av er incheckning.
5. Passbyte: den som står som `Shift.assignedEmployeeId` vid incheckning är den som arbetar. Efter ett godkänt byte är det den nya personen.

**Förslag:** i Etapp 4 skriver Admin-sidan tjänsterna `registerClockIn(db, actor, shiftId, at)` och `registerClockOut(db, actor, shiftId, at)` i
`src/server/services/worktime.ts`, så att reglerna ovan finns på ett enda ställe. Ni anropar dem från er GPS-kod. Tills dess kan ni lagra
råa händelser i era egna tabeller (`GpsClockEvent`) utan att röra `WorkTimeEntry`.

## Vad Admin vill kunna se från er (kontrakt att komma överens om)

Admin ska visa: vilka bollplockare som är incheckade, när de checkade in, hur länge de arbetat, aktuell status, position under ett aktivt pass
enligt godkända integritetsregler, GPS-avvikelser samt in-/utcheckningshistorik. Förslag: ni exporterar från `src/modules/bollplockare/api.ts`

```ts
getClockStatus(db, actor, { date }): Promise<Array<{
  employeeId: string; shiftId: string;
  state: "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT";
  checkedInAt: Date | null; checkedOutAt: Date | null;
  lastPositionAt: Date | null; deviation: string | null;
}>>
```

Funktionen kontrollerar behörighet själv (`can(actor.role, ...)`; lägg till en ny behörighet i `src/domain/roles.ts` via pull request). Tills den finns visar Admin
ett tydligt tomt tillstånd ("GPS-incheckning är inte aktiverad ännu"); Admin-sidan hittar aldrig på incheckningsstatus.

## Integritet (GPS)

Positionsdata är känsliga personuppgifter. Innan något byggs behöver verksamheten besluta: syfte, att positioner **bara samlas in under ett aktivt arbetspass**,
vem som får se dem (föreslaget: Admin, och bara under aktivt pass), gallringstid, och information till personalen. `Permissions-Policy` tillåter redan
`geolocation=(self)` i `next.config.ts`.

## Arbetsordning för att undvika konflikter

1. Läs `docs/COLLABORATION.md`. Merga `main` in i `Bollplockare` när grundstrukturen är mergad.
2. Lägg era modeller i `prisma/schema/bollplockare.prisma` och skapa migration med `npm run db:migrate -- --name gps_...`.
3. Behöver ni ett nytt fält i en gemensam modell eller en ny behörighet: egen liten pull request mot `main`.
4. Skriv tester i `tests/db/` för era regler (till exempel att en utcheckning inte kan ske före incheckning).
