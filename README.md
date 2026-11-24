# Golf Admin System

Administrationssystem för golfanläggningens personal: scheman, passbyten, arbetstid, löneunderlag och dagsavslut.
En gemensam webbapplikation för tre roller: **Admin**, **Golfshop** och **Bollplockare**.

> **Status: Etapp 1 (grundstruktur) är klar.** Inloggning, roller, databas, designsystem och domänlogik finns och är testade.
> Admin-funktioner (personal, schema, rapporter), Golfshop-panelen och dagsavslut byggs i Etapp 2–5.
> Se [Etapper och status](#etapper-och-status).

## Kom igång

Krav: Node.js 22 eller nyare. Ingen Docker eller installerad databas behövs i utveckling.

```bash
npm install                 # installerar och genererar Prisma-klienten
cp .env.example .env        # DATABASE_URL pekar redan på utvecklingsdatabasen nedan
npm run db:dev              # terminal 1: startar en lokal PostgreSQL 17 (lämna den igång)
npm run db:deploy           # terminal 2: skapar tabeller och integritetsregler
npm run db:seed:demo        # valfritt: tydligt märkt testdata (skriver ut lösenordet en gång)
npm run dev                 # startar appen på http://localhost:3000
```

Testinloggningar efter `db:seed:demo` (alla på `@demo.test`): `admin@demo.test`, `erik.andersson@demo.test` (Golfshop),
`lisa.svensson@demo.test` (Golfshop), `oscar.nilsson@demo.test` och `emma.karlsson@demo.test` (Bollplockare).
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
(vanligtvis `http://localhost:3000`; är porten upptagen väljer Next.js nästa lediga). Du hamnar direkt i Admin-vyn utan lösenord.
Nere till höger finns en växlare (Admin · Golfshop · Bollplockare), och `/dev` visar alla vyer samt ett **komponentgalleri** (`/dev/design`).
Ctrl+C stoppar allt.

Förhandsvisningen går att slå på **bara** när alla fyra villkor gäller: `DEV_PREVIEW=1` (sätts av `npm run preview`, aldrig i `.env`),
`NODE_ENV=development`, lokal databas, och den kan bara logga in som de fasta testkontona (`isTestData`, `@demo.test`).
I ett produktionsbygge ger `/dev` alltid 404, även om `DEV_PREVIEW=1` sätts av misstag (testat). Den skapar en vanlig session,
så alla roll- och behörighetskontroller gäller som vanligt.

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

- [Arkitektur och teknikval](docs/ARCHITECTURE.md)
- [Datamodell: hur personal, pass, lön och tid hänger ihop](docs/DATA-MODEL.md)
- [API- och tjänstekontrakt](docs/API-CONTRACTS.md)
- [Samarbete: branches, ägarskap, migrationer, pull requests](docs/COLLABORATION.md)
- [Integration med Bollplockare](docs/BOLLPLOCKARE-INTEGRATION.md)

## Etapper och status

| Etapp | Innehåll | Status |
|---|---|---|
| 1 | Grundstruktur, databas, roller, inloggning, designsystem, dokumentation | **Klar** |
| 2 | Admin: dashboard, personalregister, profiler, scheman, publicering | Ej påbörjad |
| 3 | Golfshop: startsida, schema, godkännande, passbyten | Ej påbörjad |
| 4 | Automatisk tidsregistrering, timlön, månadsrapporter, export | Ej påbörjad |
| 5 | Dagsavslut (bilduppladdning, lagring, notiser) | Ej påbörjad |
| 6 | Kvalitet, säkerhetstest, integration med Bollplockare, driftsättning | Ej påbörjad |
