# API- och tjänstekontrakt

Systemet har inget separat REST-API. Funktionalitet exponeras som **tjänster** (`src/server/services/`) som anropas av Server Actions,
sidor och (vid behov) Route Handlers. Det här dokumentet är kontraktet: **ändra inte en signatur eller ett beteende här utan att
meddela den andra utvecklaren** (se COLLABORATION.md). Kolumnen *Status* visar vad som faktiskt finns.

## Gemensamma konventioner

- **Actor:** `type Actor = { id: string; role: UserRole }`, alltid hämtad från sessionen (`requirePermission()` / `requireRole()`), aldrig från indata.
- **Behörighet först:** varje tjänst börjar med `can(actor.role, '<permission>')` och kastar `ForbiddenError` annars. Matrisen finns i `src/domain/roles.ts`.
- **Transaktion + revisionslogg:** skrivande tjänster tar `PrismaClient`, kör `db.$transaction(tx => …)` och anropar `writeAudit(tx, …)` i samma transaktion.
- **Fel:** tjänster kastar `AppError`-typer (`src/server/errors.ts`): `UnauthenticatedError` 401, `ForbiddenError` 403, `NotFoundError` 404,
  `ConflictError` 409, `ValidationError` 422. Server Actions översätter dem till svenska meddelanden. Tekniska fel visas aldrig för användaren.
- **Indata:** valideras med Zod i Server Action/Route Handler (form) och av domänfunktioner (regler). Pengar i ören, datum som `"YYYY-MM-DD"` (Stockholm), tidpunkter som `Date`.
- **Samtidighet:** uppdatering av pass och tidsregistrering använder `version` (`UPDATE … WHERE id AND version`); träffar den 0 rader kastas `ConflictError`.
- **Läsning av andras data:** personalvyer filtrerar alltid på `employeeId` från sessionen. Admin använder `*:read:all`-behörigheter.
- **Route Handlers** som ändrar data måste kontrollera `Origin` (CSRF) och anropa `requirePermission()`. Server Actions skyddas av Next.js.

## Behörigheter (förkortad matris)

| Behörighet | ADMIN | GOLFSHOP | BOLLPLOCKARE |
|---|:-:|:-:|:-:|
| `employees:read:all`, `employees:write` | ✔ | | |
| `payrates:read:all`, `payrates:write` | ✔ | | |
| `schedule:read:all`, `schedule:write`, `schedule:publish` | ✔ | | |
| `shift:read:own`, `shift:respond:own` | ✔ | ✔ | ✔ |
| `swap:request` | ✔ | ✔ | ✔ |
| `swap:read:all`, `swap:decide` | ✔ | | |
| `worktime:read:own` | ✔ | ✔ | ✔ |
| `worktime:read:all`, `worktime:approve`, `worktime:correct` | ✔ | | |
| `payroll:read:all`, `payroll:approve` | ✔ | | |
| `dailyclosing:submit` | ✔ | ✔ | |
| `dailyclosing:read:all`, `dailyclosing:assign` | ✔ | | |
| `notifications:read:own` | ✔ | ✔ | ✔ |
| `audit:read` | ✔ | | |

Testat i `tests/unit/roles.test.ts`. Admin äger alla behörigheter. Behörigheter som en personalroll ska få senare läggs till i `src/domain/roles.ts` tillsammans med ett test.

## Autentisering (`src/server/auth/`)

| Funktion | Beskrivning | Status |
|---|---|---|
| `authenticate(db, { email, password, ipAddress }, now?)` → `{ ok, user } \| { ok:false, reason }` | Kontrollerar uppgifter, spärr efter 5 fel (15 min), revisionslogg | Finns, testad |
| `createSession(db, userId, meta, now?)` → `{ token, expiresAt }` | Skapar session, sparar bara hash av token | Finns, testad |
| `validateSession(db, token, now?)` → `SessionUser \| null` | Giltighet, inaktivitet, aktiv användare. Ger roll, visningsnamn, `employee` | Finns, testad |
| `revokeSession`, `revokeAllUserSessions`, `purgeExpiredSessions` | Utloggning, "logga ut överallt", underhåll | Finns, testade |
| `getSessionUser()`, `requireUser()`, `requireRole(...roles)`, `requirePermission(perm)` | Data Access Layer för sidor, layouts, actions, handlers | Finns, verifierade i webbläsare |
| `hashPassword`, `verifyPassword`, `validatePasswordStrength` | Argon2id, minst 12 tecken | Finns, testade |
| Byte och återställning av lösenord; admin skapar konto | | Planerad (Etapp 2) |

`SessionUser.user` = `{ id, email, role, displayName, firstName, employee: { id, category } | null }`.

## Domänfunktioner (`src/domain/`, rena och enhetstestade)

| Modul | Funktioner |
|---|---|
| `money` | `kronorToOre`, `compensationOre(minutes, hourlyRateOre)`, `sumOre`, `formatSek`, `formatDuration` |
| `time` | `stockholmDateOf`, `localToInstant(date, time)`, `minutesBetween`, `monthBounds(year, month)`, `stockholmYearMonth`, `dateStringToDbDate`, `dbDateToString`, `formatTimeRange`, `formatDateLong/Short`, `formatMonthYear` |
| `shifts` | `analyzeShift` (automatiska kontroller), `validateShiftTimes`, `intervalsOverlap`, `isMaterialShiftChange`, `hasShiftEnded`, `hasBlockingIssues` |
| `pay-rates` | `resolveRateForDate`, `planRateChange`, `findOverlap` |
| `roles` | `can`, `permissionsOf`, `ROLE_HOME`, `categoryForRole`, `roleForCategory`, `safeInternalPath` |

## Tjänster

| Tjänst | Behörighet | Status |
|---|---|---|
| `changeHourlyRate(db, actor, { employeeId, hourlyRateOre, effectiveFrom, reason? })` | `payrates:write` | **Finns, testad** (Test 10, 11) |
| `listPayRateHistory(db, actor, employeeId)` | `payrates:read:all` | **Finns, testad** |
| `getRateForWorkDate(db, actor, employeeId, 'YYYY-MM-DD')` | `payrates:read:all` | **Finns, testad** |
| `createEmployee / updateEmployee / deactivateEmployee` | `employees:write` | Planerad, Etapp 2 |
| `createShift / updateShift / cancelShift / copyWeek / copyMonth` (kör `analyzeShift`) | `schedule:write` | Planerad, Etapp 2 |
| `publishSchedule(scheduleId)` | `schedule:publish` | Planerad, Etapp 2 |
| `respondToShift(shiftId, 'APPROVED' \| 'CHANGE_REQUESTED')` | `shift:respond:own` | Planerad, Etapp 3 |
| `createSwapRequest`, `respondToSwapAsColleague`, `postSwapMessage`, `cancelSwapRequest` | `swap:request` | Planerad, Etapp 3 |
| `decideSwapRequest(requestId, 'APPROVED' \| 'DENIED', comment)` | `swap:decide` | Planerad, Etapp 3 |
| `generateWorkTimeEntries(now)` (serverjobb, idempotent) | system | Planerad, Etapp 4 |
| `approveWorkTime`, `correctWorkTime(entryId, minutes, reason)` | `worktime:approve`, `worktime:correct` | Planerad, Etapp 4 |
| `getMonthlyReport(year, month, filters)`, `approveMonthlyReport`, `lockMonthlyReport`, exportera Excel/PDF | `payroll:*` | Planerad, Etapp 4 |
| `submitDailyClosing(file, workDate)`, `assignDailyClosingResponsible`, `listDailyClosings` | `dailyclosing:*` | Planerad, Etapp 5 |
| `listNotifications`, `markRead`, `createNotification(userId, type, …)` | `notifications:read:own` | Planerad, Etapp 2–3 |

## HTTP-endpoints

| Endpoint | Beskrivning | Status |
|---|---|---|
| `GET /api/health` | `{"status":"ok"}` (200) eller `{"status":"error"}` (503). Inga detaljer. | Finns, verifierad |
| `GET /dev/as/{admin\|golfshop\|bollplockare}` | Förhandsvisning: loggar in som testkonto och går till rollens startsida. **Bara lokalt**, annars 404 | Finns, verifierad |
| `POST /api/cron/generate-time-entries` | Serverjobb för automatisk tidsregistrering, skyddad med hemlig token | Planerad, Etapp 4 |
| `POST /api/daily-closing` | Säker bilduppladdning (typ, storlek, magic bytes, privat lagring) | Planerad, Etapp 5 |
| `GET /api/export/monthly-report?year=&month=&format=xlsx\|pdf` | Export av månadsrapport | Planerad, Etapp 4 |

## Hur Bollplockare ansluter

Se [BOLLPLOCKARE-INTEGRATION.md](BOLLPLOCKARE-INTEGRATION.md).
