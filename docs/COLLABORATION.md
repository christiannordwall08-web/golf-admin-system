# Samarbete: branches, ägarskap och migrationer

Två utvecklare, en gemensam applikation. Målet är att kunna arbeta parallellt utan att skriva över varandra.

## Branches

| Branch | Innehåll | Ägare |
|---|---|---|
| `main` | Den gemensamma, integrerade applikationen. Ska alltid gå att bygga och ha gröna tester. | Båda (via pull request) |
| `Admin` | Adminpanelen (`src/app/admin/**`) | Admin/Golfshop-utvecklaren |
| `Golfshop` | Golfshop-personalens funktioner (`src/app/golfshop/**`) | Admin/Golfshop-utvecklaren |
| `Bollplockare` | Bollplockarnas funktioner (`src/app/bollplockare/**`, `src/modules/bollplockare/**`) | Bollplockare-utvecklaren |

Vid Etapp 1 pekade alla fyra branches på samma första commit (`3529824`, bara `.gitignore` och README).
Grundstrukturen kommer in via **pull request mot `main`**. Därefter slår båda in `main` i sina egna branches.

### Regler

1. **Ändra inte den andras branch.** Admin/Golfshop-sidan rör aldrig `Bollplockare` och tvärtom.
2. **Börja aldrig en ny funktion från en gammal branchversion.** Först `git fetch` och `git merge origin/main` i din branch.
3. **Pull request mot `main` för varje färdig funktion**, litet och fokuserat. `main` ska hållas färsk så att den andra kan hämta ändringarna.
4. **Merga `main` in i din branch regelbundet** (minst före varje ny funktion och före varje pull request). Rebasa inte delade branches.
5. **Aldrig force push** till `main` eller till någon branch den andra använder.
6. **Granska konflikter innan sammanslagning.** Lös dem i din branch, kör testerna, och merga sedan.
7. Tydliga commits: vad och varför, en logisk ändring per commit.

## Ägarskap i koden

| Område | Ägare | Regel |
|---|---|---|
| `src/app/admin/**`, `src/app/golfshop/**` | Admin/Golfshop | Fritt inom sin branch |
| `src/app/bollplockare/**`, `src/modules/bollplockare/**`, `prisma/schema/bollplockare.prisma` | Bollplockare | Fritt inom sin branch |
| `prisma/schema/*` (övriga), `prisma/migrations/**` | **Gemensamt** | Se [Databasändringar](#databasändringar) |
| `src/domain/**`, `src/server/**` | **Gemensamt** | Pull request mot `main`. Ändra aldrig beteende som den andra bygger på utan att meddela |
| `src/components/ui/**`, `src/components/layout/**` | **Gemensamt** | Samma. Nav-posterna för Bollplockare i `nav-config.ts` ägs av Bollplockare |
| `src/proxy.ts`, `next.config.ts`, `package.json`, `package-lock.json` | **Gemensamt** | Små, separata pull requests |
| `docs/**` | Gemensamt | Uppdatera när du ändrar kontrakt |

**Gemensamt** betyder: gör ändringen i en egen liten pull request mot `main`, beskriv vad som ändras och att den andra påverkas, och
låt den andra hämta `main` innan hen bygger vidare på det.

## Databasändringar

Schemat är uppdelat i en fil per område i `prisma/schema/`. Bollplockare lägger sina modeller i `bollplockare.prisma`
(prefix `Gps*`/`Bollplockare*`), så att era ändringar normalt inte rör samma fil.

1. **Ändra aldrig en migration som redan finns i `main`.** Skapa en ny. (Checksummor används; en ändrad migration stoppar alla andra databaser.)
2. **Additiva ändringar först:** ny tabell, ny kolumn som är valfri eller har standardvärde. Radera inte; markera som utgående och ta bort i senare etapp efter överenskommelse.
3. **Ändring i en gemensam modell** (till exempel ett fält på `Shift` eller `Employee`): egen liten pull request mot `main` med schemaändring, migration, uppdaterad `docs/DATA-MODEL.md` och tester. Den andra hämtar `main` och kör `npm run db:deploy`.
4. **Skapa migration:** `npm run db:migrate -- --name beskrivande_namn`. Kontrollera den genererade SQL-filen. Regler som Prisma inte kan uttrycka (constraints, triggers) skrivs som SQL i migrationen och får ett test i `tests/db/integrity.test.ts`.
5. **Om båda har skapat migrationer parallellt:** behåll båda (de har olika tidsstämplar och ligger i olika mappar). Efter `git merge origin/main`, kör `npm run db:deploy` på en ren lokal databas och `npm test`. Konflikterar de innehållsmässigt: den som mergar sist skapar en ny migration som rättar till det. Skriv inte om en migration som redan delats.
6. **Enum-värden:** lägg bara till nya värden i slutet. `NotificationType` och liknande kan växa utan konflikt.
7. Ny tabell som hör ihop med en anställd ska ha `onDelete: Restrict` (historik raderas inte).

## Pull request-rutin

- Branchnamn: `foundation/…`, `feature/admin-…`, `feature/golfshop-…`, `fix/…`.
- Kör lokalt innan du öppnar: `npm run typecheck && npm run lint && npm test && npm run build`.
- Beskriv vad som byggts, vilka tester som körts, och **om något påverkar den andra utvecklaren** (schema, domän, delade komponenter).
- Uppdatera dokumentationen när du ändrar ett kontrakt (`docs/API-CONTRACTS.md`, `docs/DATA-MODEL.md`).
- Merga först när CI är grön (`.github/workflows/ci.yml`) och den andra har fått chansen att titta på gemensamma ändringar.

## Testdata

All testdata har `isTestData = true` och e-post på `@demo.test`. Den skapas bara av `npm run db:seed:demo`, som vägrar köra i production eller
mot en databas som inte är lokal. Riktig drift får aldrig innehålla testdata; `npm run db:seed` skapar enbart första administratören.
