# Arkitektur och teknikval

## Principer

1. **En applikation, en databas.** Admin, Golfshop och Bollplockare är tre ytor i samma Next.js-app och delar PostgreSQL.
   Admin kan därför se och hantera båda personalgrupperna utan synkronisering.
2. **Affärsregler finns på ett ställe.** Ren logik i `src/domain/`, databasåtkomst och behörighet i `src/server/services/`.
   Sidor och Server Actions är tunna lager ovanpå. Admin- och personalvyer återanvänder samma tjänster.
3. **Databasen är sista försvarslinjen.** Viktiga regler (ingen dubbelbokning, inga överlappande löneperioder, ingen godkänd tid
   för framtida pass, oföränderlig historik) upprätthålls av PostgreSQL själv, inte bara av koden.
4. **Servern bestämmer.** Behörighet kontrolleras i serverkod vid varje läsning och skrivning. Gränssnittet döljer bara.
5. **Allt spårbart.** Ändringar av lön, tid och tilldelning loggas i en append-only revisionslogg i samma transaktion.

## Teknikval

| Område | Val | Varför |
|---|---|---|
| Ramverk | Next.js 16, App Router, React 19 | Serverkomponenter och Server Actions ger tunn serverkod utan separat API-lager. Samma kodbas för tre roller. |
| Språk | TypeScript (strict) | Typfel fångas innan de blir fel i lönedata. |
| Databas | PostgreSQL 17 | Kräver transaktioner och constraints som exclusion constraints (överlappskydd) och triggers. |
| ORM | Prisma 7 med `@prisma/adapter-pg` | Typad åtkomst, migrationer och multi-file-schema (en fil per område ⇒ färre mergekonflikter). |
| Stil | Tailwind CSS 4, egna komponenter i shadcn-stil | Designtokens i `globals.css`. Inga tunga beroenden, full kontroll över utseendet. |
| Validering | Zod 4 | Indata valideras på servern vid varje gränssnitt. |
| Tid | Luxon | Tillförlitlig tidszons- och sommartidshantering (Europe/Stockholm). |
| Lösenord | Argon2id (`@node-rs/argon2`) | OWASP:s rekommendation. Parametrar ligger i hashen, så de kan höjas senare. |
| Tester | Vitest | Snabba enhetstester plus databastester mot en riktig PostgreSQL. |

**Version 7 av Prisma, inte 8:** `latest`-taggen på npm pekade vid byggtillfället på en release candidate (8.0.0-rc). Vi använder
den stabila 7.10.1 och uppgraderar när 8 är stabil. Ett beroende (`effect`) i Prismas CLI hade en känd sårbarhet och är
åtgärdat med `overrides` i `package.json`. `npm audit` visar 0 sårbarheter.

### Autentisering: egen minimal lösning, inte ett bibliotek

Vi använder databasbaserade sessioner (`src/server/auth/`) i stället för Auth.js eller liknande. Skäl:

- Behoven är små (e-post + lösenord, tre roller, inga externa inloggningsleverantörer) och krav på spärr, revisionslogg
  och direkt avstängning av konton är enklare att göra korrekt i ~300 rader kod vi äger och testar.
- Flera populära bibliotek är fortfarande beta-versioner eller byter API ofta.

Så fungerar det: webbläsaren får en slumpmässig 256-bitars token i en `HttpOnly`, `SameSite=Lax` cookie (`Secure` och `__Host-`-prefix i
produktion). Databasen sparar bara SHA-256 av token, så en läckt databas kan inte användas för att ta över sessioner.
Sessioner upphör efter 14 dagar (absolut) eller 7 dagar utan aktivitet och försvinner direkt när kontot inaktiveras.
Efter 5 felaktiga inloggningar spärras kontot i 15 minuter. Svaret är detsamma för okänd användare, fel lösenord och
inaktivt konto, och svarstiden jämnas ut. Allt revisionsloggas utan lösenord eller angiven e-post.
**Om kraven växer** (SSO, tvåfaktor) byter man ut `src/server/auth/login.ts` mot ett etablerat bibliotek; resten av koden
använder bara `getSessionUser()`/`requireRole()`/`requirePermission()`.

**CSRF:** Server Actions skyddas av Next.js origin-kontroll och cookien är `SameSite=Lax`. Framtida Route Handlers som ändrar
data måste själva kontrollera `Origin`.
**Bakom proxy:** inloggningens IP läses från `X-Forwarded-For`. Det är bara pålitligt bakom en betrodd proxy/hosting-plattform.
IP används bara för loggning, inte för åtkomstbeslut.

### Varför `cacheComponents` är avstängt

Next.js 16:s mall slår på Cache Components och Partial Prefetching. Vi har stängt av dem (`next.config.ts`). All personal-, schema-
och lönedata är per användare och måste alltid vara färsk; ett cachefel skulle kunna visa gamla belopp eller en annan persons
data. Utan Cache Components renderas alla sidor dynamiskt vid varje anrop. Det går att införa selektivt senare för
data som inte är personlig (till exempel väderdata), men aldrig för löne- eller schemadata.

## Lager

```
Sida / layout / Server Action   src/app/**        Hämtar användare (DAL), validerar indata, anropar tjänst
        │
Tjänst (service)                src/server/services/**   actor + behörighet, transaktion, revisionslogg, AppError
        │                                           
Domänlogik (ren)                src/domain/**     Pengar, tid, passkontroller, lönehistorik, behörighetsmatris
        │
Databas                         prisma/**         Schema, migrationer, constraints, triggers
```

- **`src/domain/`** importerar aldrig databas eller Next.js. Allt där är enhetstestat och kan användas i både server och klient.
- **Tjänster** tar emot `actor` från sessionen (aldrig från formulär) och kontrollerar `can(actor.role, permission)` **först**.
  Mönstret finns i `src/server/services/pay-rates.ts`.
- **Data Access Layer** för autentisering: `src/server/auth/current-user.ts`. `proxy.ts` gör bara en optimistisk kontroll
  (finns en sessionscookie?) och är inte säkerhet.
- **Layouts körs inte vid varje klientnavigering** i Next.js. Därför anropar både layout *och* sida `requireRole()`.

## Tid, datum och pengar

- Presentation och all gruppering per dag/månad sker i **Europe/Stockholm**. Tidpunkter lagras som UTC (`timestamptz`).
- Arbetsdagen för ett pass är Stockholm-datumet för starttiden (`Shift.localDate`). Ett pass som börjar 23.30 räknas på den dagen,
  även om det slutar efter midnatt. Timlön bestäms av arbetsdagen.
- Varaktighet räknas på verklig förfluten tid. Nattpass över sommar-/vintertidsbyte blir därför 1 timme kortare/längre än klockan antyder
  (testat i `tests/unit/time.test.ts`).
- Ogiltiga klockslag (hoppet vid sommartid) avvisas. Dubbeltydiga klockslag (vintertid) tolkas som den första förekomsten.
- **Pengar är heltal i ören.** Ersättning = `minuter × timlön(öre) / 60`, avrundat halv-upp till hela ören **en gång per rad**, med
  BigInt (inga flyttalsfel). Summor summeras från de avrundade raderna.
- Systemet skapar **löneunderlag, inte löneutbetalningar**. OB, raster och tillägg är medvetet inte implementerade (inga påhittade
  avtalsregler); `PayrollAdjustment` är förberedd för dem.

## Säkerhet i korthet

| Hot | Skydd |
|---|---|
| Anställd ändrar URL eller skickar eget anrop | Rollkontroll i layout, sida, Server Action och tjänst. Fel roll studsas till egen startsida (testat i webbläsare och med curl). |
| Anställd ändrar sin egen lön/tid | `payrates:write`, `worktime:approve`, `worktime:correct` finns bara för ADMIN. Tjänsten nekar (test: `tests/db/pay-rate-service.test.ts`). |
| Gissning av lösenord | Argon2id, spärr efter 5 försök, enhetligt svar, revisionslogg. |
| Stulen databas | Sessionstoken lagras som hash, lösenord som Argon2id. |
| Förfalskad cookie | Token slås upp i databasen. Okänd token ⇒ omdirigering till inloggning (HTTP 307, testat). |
| Öppen omdirigering via `?next=` | `safeInternalPath()` släpper bara igenom interna sökvägar (enhetstestat). Notislänkar likaså (databas-constraint). |
| Dubbelbokning vid samtidiga ändringar | Exclusion constraint i databasen, `Shift.version` för optimistisk låsning. |
| Ändrad eller raderad historik | Append-only-triggers på revisionslogg, tilldelningshistorik, godkännanden, korrigeringar och meddelanden. `onDelete: Restrict` överallt. |
| Läckta uppgifter i loggar | Inloggningsloggen innehåller varken lösenord eller angiven e-post (testat). |
| Klickjacking, MIME-sniffing | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (verifierat i webbläsare). |
| Indexering av internt system | `robots: noindex`, `robots.txt` med `Disallow: /`. |

**Ännu inte på plats** (planerat): lösenordsbyte och återställning (Etapp 2), IP-baserad begränsning av inloggningsförsök,
Content-Security-Policy, säker bilduppladdning (Etapp 5), automatiska säkerhetstester av alla endpoints (Etapp 6).
I produktion bör databasanvändaren sakna `TRUNCATE`/`DROP`-rättigheter (append-only-triggers stoppar `UPDATE`/`DELETE`, inte `TRUNCATE`).

## GDPR och lagring

- Personuppgifter som lagras: namn, kontaktuppgifter, anställningsdatum, löneuppgifter, arbetstider. Åtkomst begränsas av roll;
  anställda ser bara sitt eget.
- Historik raderas inte (databasen förbjuder det). När någon slutar sätts `status = INACTIVE`, kontot inaktiveras och sessioner
  stängs. Rensning eller anonymisering efter lagringstidens slut görs med en särskild, loggad åtgärd (Etapp 6).
- **Att bekräfta med revisor/dataskyddsansvarig:** lagringstider (löneunderlag omfattas normalt av bokföringslagens sjuåriga
  arkivering), rättslig grund, och särskilt integritetsreglerna för GPS-positioner (Bollplockare).
- Inga tredjeparts-typsnitt eller externa skript laddas (inga externa anrop från webbläsaren). Externa mejlutskick är av
  (`EMAIL_NOTIFICATIONS_ENABLED=false`) tills en leverantör uttryckligen konfigurerats.

## Drift (förberedelse)

- `GET /api/health` svarar `{"status":"ok"}` (200) eller 503 utan detaljer. Kontrollerar databasanslutningen.
- Hosting med hanterad PostgreSQL med automatiska backuper rekommenderas. Objektlagring (S3-kompatibel, privat bucket) behövs
  för dagsavslutsbilder i Etapp 5. Filer får aldrig ligga i GitHub eller på serverns temporära disk.
- Miljövariabler valideras vid första användning (`src/server/env.ts`), inte vid bygge, så CI kan bygga utan hemligheter.
- Schemalagt jobb (Etapp 4) för automatisk tidsregistrering måste köras av plattformens cron eller motsvarande, inte av en öppen webbsida.
