# Golf Admin System

Administrationssystem för golfanläggningens personal: scheman, passbyten, arbetstid, löneunderlag och dagsavslut.
En gemensam webbapplikation för tre roller: **Admin**, **Golfshop** och **Bollplockare**.

> **Status:** Etapp 1 (grundstruktur) är klar och Admin har fått sina första riktiga sidor. Det finns **två separata inloggningar**
> (Admin och Anställd), en adminöversikt, personal med löner och timmar, och hela scheman för Golfshop och Bollplockare (visning).
> Anställd ser sin egen start, sitt schema och sina timmar. **Admin kan skapa, ändra, ställa in, återställa och publicera pass** (`/admin/schema`).
> **Nytt:** inloggningsvalet Admin/Anställd följt av arbetsplatsval (golfshop, bollplockare eller båda), notiser, dagsavslut med bilduppladdning, passbyten
> (Golfshop och Bollplockare) och **hela bollplockarmodulen**: pass utan fast sluttid, klocka in/ut, GPS-geofencing med säkerhetsmarginal, automatiska pauser,
> Admins realtidsöversikt med karta, arbetstidsrapporter, korrigeringar och CSV-export. Se [docs/BOLLPLOCKARE-GPS.md](docs/BOLLPLOCKARE-GPS.md).
> Golfshops automatiska tidsregistrering från schemat och månadsrapportens låsning byggs fortfarande. Se [Etapper och status](#etapper-och-status).

## Två inloggningar

| Inloggning | Adress | Vem | Vad man ser |
|---|---|---|---|
| **Admin** | `/login/admin` | Konton med admin-åtkomst | Översikt, **alla anställda med timlön, arbetade och kommande timmar**, personalprofiler och **hela scheman för både Golfshop och Bollplockare** |
| **Anställd** | `/login/anstalld` | Alla med minst en aktiv anställning | Bara det egna: start, **mitt schema**, **mina timmar** i golfshopen och/eller som bollplockare |

Valet görs på `/login`. En person kan vara båda (till exempel ägaren som också jobbar) och kan ha anställning i både Golfshop och Bollplockare.
**Inloggningen som användes styr vad sessionen får göra:** i en Anställd-session ser man aldrig andras löner eller timmar, även om kontot också är admin
(testat i `tests/db/auth.test.ts` och `tests/db/queries.test.ts`).

## Kom igång

> Vill du bara se och prova allt på din egen dator? Följ [docs/KOM-IGANG.md](docs/KOM-IGANG.md): `git clone`, `npm install`, `npm run preview`.

Krav: Node.js 22 eller nyare. Ingen Docker eller installerad databas behövs i utveckling.

```bash
npm install                 # installerar och genererar Prisma-klienten
cp .env.example .env        # DATABASE_URL pekar redan på utvecklingsdatabasen nedan
npm run db:dev              # terminal 1: startar en lokal PostgreSQL 17 (lämna den igång)
npm run db:deploy           # terminal 2: skapar tabeller och integritetsregler
npm run db:seed:demo        # valfritt: tydligt märkt testdata (skriver ut lösenordet en gång)
npm run dev                 # startar appen på http://localhost:3000
```

Testinloggningar efter `db:seed:demo` (alla på `@demo.test`): `admin@demo.test` (Admin) samt anställda i Golfshop (`erik.andersson`, `lisa.svensson`,
`sara.lindqvist`, `johan.berg`) och Bollplockare (`oscar.nilsson`, `emma.karlsson`, `viktor.holm`, `alice.ek`, `noah.lund`), med timlön och testschema för innevarande och nästa månad.
Sätt `DEV_SEED_PASSWORD` i miljön för att välja lösenord själv, annars slumpas ett.

> **npm 11 och installationsskript:** npm 11 blockerar skript i beroenden som standard. `package.json` tillåter (`allowScripts`) bara det som behövs för
> testdatabasen (`@embedded-postgres/*`).

**Riktig drift:** kör inte `db:seed:demo`. Skapa första administratören med `npm run db:seed` (se `.env.example`).

## Titta på appen utan inloggning (förhandsvisning)

Vill du bara se hur allt ser ut? Kör ett enda kommando, utan att ha något annat igång:

```bash
npm run preview
```

Det startar lokal databas, skapar tabeller, lägger in testdata och startar appen i **förhandsvisningsläge**. Öppna adressen som skrivs ut
(vanligtvis `http://localhost:3000`; är porten upptagen väljer Next.js nästa lediga). Ctrl+C stoppar allt.

1. Första gången ser du **Skapa ditt konto**: skriv bara **förnamn och efternamn**. Kontot blir administratör och anställd i både Golfshop och
   Bollplockare, med timlön och testschema.
2. Du kommer direkt in i **Admin**. Växlaren nere till höger (Admin · Anställd Golfshop · Anställd Bollplockare) byter inloggning med samma person.
   `/dev` visar valen, och `/dev/design` är ett komponentgalleri.

Förhandsvisningen går att slå på **bara** när alla villkor gäller: `DEV_PREVIEW=1` (sätts av `npm run preview`, aldrig i `.env`),
`NODE_ENV=development`, lokal databas, och den kan bara logga in som testprofiler (`isTestData`, `@demo.test`).
I ett produktionsbygge ger `/dev` alltid 404, även om `DEV_PREVIEW=1` sätts av misstag (testat). Den skapar en vanlig session med rätt
inloggningstyp, så alla roll- och behörighetskontroller gäller som vanligt.

## Egen schema- och personaldata (utanför git)

Vill du se **riktiga** personer och pass i stället för påhittade? Lägg en JSON-fil i `.local/` (mappen ignoreras av git, och **repot är publikt**, så
riktiga namn och scheman ska aldrig committas):

```json
{
  "category": "GOLFSHOP",
  "approvalStatus": "APPROVED",
  "employees": [{ "firstName": "Anna", "hourlyRateKr": 150, "rateFrom": "2026-01-01" }, { "firstName": "Bo", "admin": true }],
  "shifts": [{ "employee": "Anna", "date": "2026-11-01", "from": "11:00", "to": "15:00", "notes": "öppnar" }]
}
```

`hourlyRateKr`, `notes`, `admin` och `hourlyPaid` är valfria. `"admin": true` markerar en **administratör som styr över de anställda**: importen skapar ett admin-konto
(utan användbart lösenord, så ingen kan logga in förrän riktiga konton skapas) kopplat till personens anställning, och personen ingår **inte i timlön** (`hourlyPaid` är då `false`
som standard). I Admin-vyn visas hen under **Administratörer** med "Ej timlön" och står kvar i schemat med en Admin-markering. Utan timlön visas **Lön saknas** (aldrig 0 kr) och passen ingår inte i ersättningen, men timmarna räknas. `notes` är fri text
från schemat (t.ex. "öppnar") och visas vid passet.

- `npm run db:import -- .local/min-fil.json` läser in den i den lokala databasen. Importen är idempotent (inget dubbleras) och vägrar köra i production eller mot en
  icke-lokal databas. Är en timlön fel (en enda lönepost) rättas den när du kör om med ny `hourlyRateKr`. Efternamn är valfritt.
- `npm run preview` importerar alla `.local/*.json` och **hoppar då över påhittad testdata**, så riktiga och påhittade personer aldrig blandas.
- Skapar du ett förhandsvisningskonto med samma förnamn som en importerad anställning utan efternamn tar kontot över den anställningen (med dess pass och lön).

## Kommandon

| Kommando | Vad det gör |
|---|---|
| `npm run preview` | Allt på en gång, utan inloggning, med testdata (se ovan) |
| `npm run dev` / `build` / `start` | Utvecklingsserver / produktionsbygge / produktionsserver |
| `npm run typecheck` / `lint` | TypeScript- och ESLint-kontroll |
| `npm test` | Alla tester (enhetstester + databastester). Startar en egen engångs-PostgreSQL |
| `npm run test:watch` | Testerna i bevakningsläge |
| `npm run db:migrate` | Skapa och applicera en ny migration efter schemaändring (utveckling) |
| `npm run db:deploy` | Applicera befintliga migrationer (utveckling och produktion) |
| `npm run db:import -- <fil>` | Importera schema/personal från en JSON-fil i `.local/` (lokalt, se ovan) |
| `npm run db:generate` | Generera Prisma-klienten (körs även vid `npm install`) |

## Teknik

Next.js 16 (App Router) · TypeScript · React 19 · Tailwind CSS 4 · PostgreSQL 17 · Prisma 7 · Zod · Luxon · Vitest.
Motiveringar finns i [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mappstruktur

```
prisma/schema/        Databasmodell, en fil per område (se docs/DATA-MODEL.md)
prisma/migrations/    SQL-migrationer, inklusive handskrivna integritetsregler
src/domain/           Rena affärsregler utan databas: pengar, tid, pass, lönehistorik, behörigheter
src/server/           Serverkod: databas, autentisering, tjänster (services), revisionslogg
src/app/              Sidor och Server Actions. admin/, golfshop/, bollplockare/ är rollernas områden
src/components/       ui/ (designsystem) och layout/ (appskal, navigering)
tests/unit/           Enhetstester för src/domain
tests/db/             Tester mot riktig PostgreSQL: integritetsregler, autentisering, tjänster
docs/                 Arkitektur, datamodell, API-kontrakt, samarbetsregler, Bollplockare-integration
```

## Dokumentation

- [**Kom igång på din egen dator** (egen localhost, steg för steg)](docs/KOM-IGANG.md)
- [Arkitektur och teknikval](docs/ARCHITECTURE.md)
- [Datamodell: hur personal, pass, lön och tid hänger ihop](docs/DATA-MODEL.md)
- [API- och tjänstekontrakt](docs/API-CONTRACTS.md)
- [Samarbete: branches, ägarskap, migrationer, pull requests](docs/COLLABORATION.md)
- [Integration med Bollplockare](docs/BOLLPLOCKARE-INTEGRATION.md)
- [Bollplockare: schema, GPS och tidsregistrering (teknik, begränsningar, integritet, test)](docs/BOLLPLOCKARE-GPS.md)

## Etapper och status

| Etapp | Innehåll | Status |
|---|---|---|
| 1 | Grundstruktur, databas, roller, inloggning, designsystem, dokumentation | **Klar** |
| 2 | Admin: dashboard, personalregister, profiler, scheman, publicering | **Delvis:** dashboard, personal & löner, profil och schema (visning) klara. Skapa, ändra, ställ in/återställ och publicera pass klart. Kopiera vecka/månad, personhantering, lösenord och notiser återstår |
| 3 | Golfshop: startsida, schema, godkännande, passbyten | **Delvis:** start, mitt schema och mina timmar klara. Godkänna pass och passbyten återstår |
| 4 | Automatisk tidsregistrering, timlön, månadsrapporter, export | **Delvis:** bollplockarnas registrerade tid, granskning, godkännande, korrigering och CSV klara. Golfshops automatiska registrering från schema och månadslåsning återstår |
| 5 | Dagsavslut (bilduppladdning, lagring, notiser) | **Klar** (lokal lagring `STORAGE_DIR`) |
| 6 | Kvalitet, säkerhetstest, integration med Bollplockare, driftsättning | Ej påbörjad |
