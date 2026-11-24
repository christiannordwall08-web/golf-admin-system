# Kom igång på din egen dator

Den här guiden är för dig som vill **se hela systemet och köra det lokalt** (en egen localhost), till exempel en ny person i teamet.
Allt körs på din dator. Inget skickas någonstans, och du behöver varken Docker, en installerad databas eller något lösenord.

## 1. Installera (en gång)

- **Node.js 22 eller nyare** (ladda ner från nodejs.org). Kontrollera med `node -v`.
- **Git**.

## 2. Hämta koden

```bash
git clone https://github.com/christiannordwall08-web/golf-admin-system.git
cd golf-admin-system
git checkout Golfshop
```

Branchen `Golfshop` innehåller hela systemet (Admin, Golfshop och Bollplockare). Se [COLLABORATION.md](COLLABORATION.md) för vilken branch som är vems.

## 3. Installera och starta

```bash
npm install
npm run preview
```

`npm run preview` startar en lokal databas, skapar tabellerna, lägger in **påhittad testdata** och startar appen i förhandsvisningsläge (utan inloggning).
Öppna adressen som skrivs ut i terminalen, oftast `http://localhost:3000` (är porten upptagen väljer Next.js nästa lediga, till exempel 3001).
Första starten tar någon minut. Ctrl+C stoppar allt.

> Du behöver **inte** göra `cp .env.example .env` för `npm run preview`. Det behövs bara om du kör `npm run dev` själv.

## 4. Det här ser du

1. Första gången: **Skapa ditt konto**. Skriv bara förnamn och efternamn. Kontot blir administratör och anställd i både Golfshop och Bollplockare.
2. Växlaren nere till höger byter mellan **Admin**, **Anställd Golfshop** och **Anställd Bollplockare** med samma person.
3. `/login` visar den riktiga inloggningssidan: först **Admin eller Anställd**, sedan arbetsplatsen (golfshop, bollplockare eller båda).

| Del | Vad du kan prova |
|---|---|
| **Admin** | Översikt, personal och löner, schema (dra ett namn till en dag, standard 11.00–15.00), passbyten, dagsavslut |
| **Admin → Bollplockare** | Realtidsöversikt, karta och arbetsområde, range- och GPS-inställningar, planering, arbetstid och rapporter (CSV), korrigeringar |
| **Golfshop** | Mitt schema, mina timmar, passbyten, dagsavslut med bild och dagens summa |
| **Bollplockare (mobil)** | Klocka in och ut, automatisk paus utanför området, mina timmar, passbyten |

### Testa GPS utan att gå ut

GPS-simuleringen finns **bara i förhandsvisningen** och aldrig i ett produktionsbygge.

1. Gå till `/dev/gps` och tryck **Skapa fiktivt testområde** och sedan **Skapa testpass idag**.
2. Välj **Anställd → Som bollplockare**. Under klockan finns GPS-simuleringen (inne, utanför, dålig signal, hopp och så vidare).
3. Titta på resultatet som **Admin**: Bollplockare (realtid och karta), Notiser och Arbetstid och rapporter.

Hela teststegen och tekniken står i [BOLLPLOCKARE-GPS.md](BOLLPLOCKARE-GPS.md).

## Egen data

Allt du ser första gången är påhittat. Vill du se egna personer och pass lägger du en JSON-fil i mappen `.local/` (se README, avsnittet *Egen schema- och personaldata*).
Mappen ignoreras av git och **repot är publikt**, så riktiga namn, löner och scheman får **aldrig** committas.

## Kommandon du kommer använda

| Kommando | Vad det gör |
|---|---|
| `npm run preview` | Startar allt för att titta och prova |
| `npm test` | Alla tester (startar en egen engångsdatabas) |
| `npm run typecheck` och `npm run lint` | Typ- och kodkontroll |
| `npm run build` | Produktionsbygge |

## Om något går fel

| Problem | Lösning |
|---|---|
| `node -v` visar lägre än 22 | Installera en nyare Node.js |
| Porten för databasen (5433) är upptagen | Stäng det som använder den, till exempel en tidigare `npm run preview` som fortfarande körs |
| Sidan visar gamla fel efter ett byte av branch | Stoppa servern, kör `npm install` och starta om `npm run preview` |
| Du vill börja om med tom databas | Stoppa servern och ta bort mappen `.pgdata/` (den ligger i git-ignore) |

## Arbeta vidare

- Skapa en **egen branch** från `Golfshop` (till exempel `feature/golfshop-…`) och öppna en pull request. Pusha inte till någon annans branch.
- Kör `npm run typecheck && npm run lint && npm test` innan du öppnar en pull request.
- Läs [COLLABORATION.md](COLLABORATION.md) för ägarskap och regler för databasändringar.
