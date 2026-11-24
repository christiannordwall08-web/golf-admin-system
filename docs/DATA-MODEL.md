# Datamodell

Så hänger personal, arbetspass, lönehistorik och tidsregistrering ihop. Schemat finns i `prisma/schema/` (en fil per område).
**Status:** modellen och alla databasregler nedan är implementerade och testade (`tests/db/`). De arbetsflöden som beskrivs under
[Arbetsflöden](#arbetsflöden) är *design* för kommande etapper; de är ännu inte kodade.

## Översikt

```
User ──1:N── Employee ──< PayRate   (en anställning per arbetskategori)                    timlön med giltighetsperioder
 │                  │
 │                  ├──< Shift (assignedEmployeeId)     ansvarig just nu  → får timmarna
 │                  ├──< Shift (originalEmployeeId)     ursprunglig       → ändras aldrig
 │                  │
 │      Schedule (kategori + månad) ──< Shift ──< ShiftAssignmentHistory   (vem ansvarade när, varför)
 │            └──< SchedulePublication                    │──< ShiftApproval        (den anställdas beslut)
 │                                                        │──< ShiftSwapRequest ──< ShiftSwapMessage
 │                                                        └──1:0..1── WorkTimeEntry ──< WorkTimeCorrection
 │                                                                         │
 │                                              MonthlyPayrollReport ──< PayrollReportLine (fryst rad med namn)
 │                                                        └──< PayrollAdjustment
 ├──< Session
 ├──< Notification
 └──< AuditLog
DailyClosing, DailyClosingAssignment   (dagsavslut, kopplas till anställd och arbetsdag)
```

## Modeller

| Modell | Syfte | Fil |
|---|---|---|
| `User` | Inloggning och åtkomstnivå. `role = ADMIN` får använda admininloggningen. Har 0–N anställningar. `name` används bara för användare utan personalpost. | people |
| `Session` | Databassession. `id` är SHA-256 av tokenen. `context` (`ADMIN` / `EMPLOYEE`) anger vilken inloggning den kommer från och vilken panel den får använda. | people |
| `Employee` | En anställning i personalregistret: namn, **arbetskategori**, status, kontaktuppgifter. Unik på (användare, kategori), så en person kan vara anställd i både Golfshop och Bollplockare. `hourlyPaid = false` betyder att personen **inte ingår i timlön/löneunderlag** (t.ex. en administratör som styr över de anställda): visas då som "Ej timlön" (aldrig "Lön saknas") och räknas inte i timlönekostnaden. En **administratör** i vyerna = admin-konto kopplat till en anställning som inte är timanställd. Källan till alla namn som visas. | people |
| `Schedule` | Ett månadsschema per kategori (Schema A Golfshop, Schema B Bollplockare). Unik på (kategori, år, månad). | scheduling |
| `SchedulePublication` | En rad per publicering (vem, när, hur många pass/anställda). | scheduling |
| `Shift` | Ett arbetspass. Alltid kopplat till en ansvarig anställd. | scheduling |
| `ShiftAssignmentHistory` | Append-only: varje byte av ansvarig person (även första tilldelningen). | scheduling |
| `ShiftApproval` | Append-only: den anställdas beslut om passet, för en viss version av passet. | scheduling |
| `ShiftSwapRequest` / `ShiftSwapMessage` | Ändrings-/bytesförfrågan med status och en meddelandetråd (append-only). | scheduling |
| `PayRate` | Timlöneperiod: `hourlyRateOre`, `validFrom`, `validTo` (exklusivt). | time-pay |
| `WorkTimeEntry` | Exakt en per pass. Schemalagd, registrerad och godkänd tid hålls isär. | time-pay |
| `WorkTimeCorrection` | Append-only: varje korrigering med orsak. | time-pay |
| `MonthlyPayrollReport` / `PayrollReportLine` / `PayrollAdjustment` | Månadsrapport, fryst rad per pass (med namn) och justeringar efter godkännande. | time-pay |
| `DailyClosing` / `DailyClosingAssignment` | Dagsavslutsbild (metadata, filen ligger i skyddad lagring) och vem som ansvarar en viss dag. | closing |
| `Notification` | Notis per användare, läs/oläst. Länkar får bara vara interna sökvägar. | system |
| `AuditLog` | Append-only revisionslogg. | system |

Från specens modellista: `Role` är enumet `UserRole`, och `Employment` ingår i `Employee` (`status`, `employmentStartDate`,
`employmentEndDate`). En separat anställningstabell tillför inget förrän man behöver flera anställningsperioder per person.

## Tre skilda statusar på ett pass

Blanda aldrig ihop dessa (spec kapitel 7):

| Fält | Värden | Betyder |
|---|---|---|
| `publicationStatus` | `DRAFT`, `PUBLISHED` | Syns passet för personalen? |
| `approvalStatus` | `PENDING`, `APPROVED`, `CHANGE_REQUESTED`, `APPROVED_AFTER_SWAP` | Har den ansvariga accepterat passet? |
| `workStatus` | `SCHEDULED`, `COMPLETED`, `CANCELLED`, `ABSENT` | Vad hände i verkligheten? |

## Fyra tidsbegrepp

| Begrepp | Var | Anmärkning |
|---|---|---|
| Schemalagd tid | `Shift.startsAt/endsAt`, snapshot i `WorkTimeEntry.scheduledMinutes` | Planen. |
| Preliminärt registrerad tid | `WorkTimeEntry.registeredMinutes` | Från schemat (Golfshop) eller GPS (Bollplockare). Ger ingen ersättning. |
| Godkänd arbetstid | `WorkTimeEntry.approvedMinutes` | Sätts av Admin. **Bara denna ger ersättning.** `null` tills godkänd. |
| Korrigerad arbetstid | `WorkTimeCorrection` | Logg över varje ändring (före, efter, orsak, vem). Status `CORRECTED` på posten. |

**Ersättning** = `compensationOre(approvedMinutes, timlön som gällde arbetsdagen)`. Timlönen väljs på passets arbetsdag
(`resolveRateForDate`) och fryses vid godkännande genom `WorkTimeEntry.payRateId`.

## Namn och ansvar: rätt person på varje rad

- Namn hämtas alltid från `Employee` via relation. Inga namn lagras utanför `PayrollReportLine.employeeName`, som är en medveten
  **ögonblicksbild** vid godkännande så att historiska rapporter inte ändras av senare namnbyten.
- `Shift.assignedEmployeeId` = den som är ansvarig nu. `Shift.originalEmployeeId` = den som först tilldelades; en databastrigger
  förbjuder att den ändras. `ShiftAssignmentHistory` visar hela kedjan.
- `WorkTimeEntry.employeeId` = den som har rätt till ersättningen (den som faktiskt arbetade). Efter ett godkänt byte är det
  den nya personen, och rapporten visar henne på passets rad. Den ursprungliga tilldelningen syns i passets historik.
- Flera pass samma dag (för olika eller samma person) är olika `Shift`-rader och olika rader i rapporten.

## Databasgarantier

Reglerna nedan upprätthålls av PostgreSQL oavsett vilken kod som skriver. De ligger i migrationen
`*_integrity_constraints` och testas i `tests/db/integrity.test.ts`.

| Regel | Mekanism |
|---|---|
| En person kan inte ha två överlappande pass (inställda undantas) | Exclusion constraint `Shift_no_overlap_per_employee` (`btree_gist`), `DEFERRABLE` så att byten kan göras atomiskt |
| Slut > start på pass | `CHECK` |
| `originalEmployeeId` är oföränderlig | Trigger |
| Högst en öppen byteförfrågan per pass | Partiellt unikt index |
| Man kan inte föreslå sig själv som ersättare | `CHECK` |
| Lönenivåer för samma anställd överlappar aldrig | Exclusion constraint `PayRate_no_overlap` |
| Exakt en tidsregistrering per pass (ingen dubblering) | `UNIQUE (shiftId)` |
| Ett framtida pass får inte få tidsregistrering eller godkännas | Trigger `WorkTimeEntry_guard` |
| Godkänd tid kräver minuter, tidpunkt och godkännare | `CHECK` |
| Historik, godkännanden, korrigeringar, meddelanden, revisionslogg kan aldrig ändras/raderas | Triggers (`UPDATE`/`DELETE` nekas) |
| Historiska poster kan inte raderas via sin anställd/användare | `onDelete: Restrict` |
| E-post sparas som gemener | `CHECK` |
| Notislänkar är interna sökvägar | `CHECK` |
| Ett pass kan inte vara okopplat till en anställd | `NOT NULL` + främmande nyckel |

**Hanteras i tjänstelagret** (databasen kan inte avgöra det): att passets kategori stämmer med anställds kategori, att en inaktiv
anställd inte schemaläggs, och om ett godkänt pass ändras ska nytt godkännande krävas. Se `analyzeShift()` i `src/domain/shifts.ts`.

## Arbetsflöden (design, byggs i Etapp 2–4)

### Publicera ett månadsschema
*Status: steg 1, 2 och 4 (utan notiser) är implementerade i `src/server/services/shifts.ts` och testade (`tests/db/shifts-service.test.ts`). Steg 3 (anställdas godkännande) och notiser återstår.*

1. Admin skapar `Schedule` (kategori + månad) och `Shift`-rader som `DRAFT`. Varje ändring körs genom `analyzeShift()` och databasen.
2. Admin förhandsgranskar och klickar *Publicera*. I en transaktion: pass `PUBLISHED`, `Schedule` `PUBLISHED`, en `SchedulePublication`,
   en `Notification` per berörd anställd, en revisionsrad. Inget publiceras automatiskt.
3. Varje anställd accepterar (`APPROVED`) eller begär ändring (`CHANGE_REQUESTED`). Beslutet sparas i `ShiftApproval` med passets `version`.
4. Ändrar Admin ett godkänt pass väsentligt (`isMaterialShiftChange`): `approvalStatus` sätts tillbaka till `PENDING` och den anställde notifieras.

### Passbyte
1. Den anställde skapar `ShiftSwapRequest` (orsak, valfri ny tid, valfri föreslagen kollega). Med kollega: `AWAITING_COLLEAGUE`, annars `AWAITING_ADMIN`.
   Passets `approvalStatus` blir `CHANGE_REQUESTED`. Förfrågan sparar passets `version`.
2. Kollegan accepterar (⇒ `AWAITING_ADMIN`, Admin notifieras) eller nekar (`DECLINED_BY_COLLEAGUE`). Meddelanden skrivs i `ShiftSwapMessage`.
3. **Inget är definitivt förrän Admin godkänner.** Admin godkänner i en transaktion: kontrollera att passets `version` är oförändrad,
   att den nya personen inte har ett överlappande pass och rätt kategori; uppdatera `assignedEmployeeId`, öka `version`, sätt
   `approvalStatus = APPROVED_AFTER_SWAP`; skriv `ShiftAssignmentHistory` (`SHIFT_SWAP`); förfrågan `APPROVED`; notifiera båda; revisionsrad.
   Vid nekande: `DENIED`, passets status återställs.
4. Ursprunglig tilldelning (`originalEmployeeId` och historiken) finns kvar. Framtida tidsregistrering skapas på den nya personen.

### Automatisk tidsregistrering (Golfshop)
Ett serverjobb (inte beroende av en öppen webbsida) hittar pass där `endsAt <= nu`, `workStatus = SCHEDULED`, `publicationStatus = PUBLISHED`
och som saknar `WorkTimeEntry`, och skapar i en transaktion exakt en preliminär post (`source = SCHEDULE`, `employeeId = assignedEmployeeId`)
och sätter passet `COMPLETED`. Dubblering är omöjlig (`UNIQUE (shiftId)`) och framtida pass nekas av triggern. Inställda pass skapar ingen post;
frånvaro markeras som `ABSENT` och ger ingen post med godkänd tid.

### Lön och månadsrapport
1. Admin godkänner/korrigerar posten: `approvedMinutes`, `status` `APPROVED` eller `CORRECTED`, `payRateId` sätts, `WorkTimeCorrection` loggas vid ändring.
2. Månadsrapporten (`DRAFT`) beräknas live: en rad per godkänt pass med **datum, anställd, arbetskategori, schemalagd tid, godkänd tid, timlön,
   ersättning, status**, filtrerbar och sorterbar. Framtida och ogodkända pass räknas inte som intjänad ersättning.
3. *Godkänn månad* ⇒ `APPROVED`: raderna fryses som `PayrollReportLine` (inklusive namn) och summor sparas. *Lås* ⇒ `LOCKED`:
   därefter ändras siffrorna bara via `PayrollAdjustment` med orsak, vem och när.
4. Ändrad timlön gäller bara från ett senare datum (`planRateChange`). Tidigare pass räknas med den lön som gällde då.

## Öppna frågor till verksamheten
- Ska pass som den anställde **aldrig accepterat** (`PENDING`) ändå ge preliminär tidsregistrering? Förslag: ja, eftersom schemat är fastställt, men
  Admin ser tydligt att godkännande saknas.
- Hur länge ska löneunderlag och personuppgifter sparas? (Se ARCHITECTURE.md, GDPR.)
