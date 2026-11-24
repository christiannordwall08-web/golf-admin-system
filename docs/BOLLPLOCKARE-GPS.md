# Bollplockare, schemaläggning och GPS-baserad tidsregistrering

Det här dokumentet beskriver hur bollplockarfunktionerna fungerar tekniskt, hur Admin ställer in dem, vad webbläsaren inte kan garantera,
och vad verksamheten behöver ordna **innan GPS används med riktig personal**.

## 1. Sammanfattning

- Bollplockarna har **ingen fast sluttid**. Arbetet utgår från driving rangens stängningstid och slutar när bollarna är plockade.
  Admin lägger in *vem och vilka dagar*, aldrig en sluttid.
- Bollplockaren **klockar in själv** tidigast X minuter före stängning (standard 20) och **klockar ut själv**. Allt avgörs på servern.
- Under passet kontrolleras via webbläsarens GPS att personen är inom det **polygonbaserade arbetsområdet** plus en **säkerhetsmarginal** (standard 40 m).
  Utanför marginalen, bekräftat av flera pålitliga mätningar, **pausas** tiden automatiskt och **återupptas** när personen är tillbaka.
- Tiden lagras i `WorkTimeEntry` (`source = GPS`) som all annan lönegrundande tid. Admin granskar, godkänner eller korrigerar. Bara godkänd tid ger ersättning.

## 2. Datamodell (migrationerna `20261125100000…` till `20261125120000…`)

| Tabell | Innehåll |
|---|---|
| `BollplockareSettings` | En rad: stängningstid (20.00), incheckningsmarginal (20 min), verifieringstid (30 s), högsta GPS-osäkerhet (50 m), "gammal position" (120 s), återupptagningsmarginal (10 m), lagringstid för positioner (30 dygn), påminnelse om utcheckning (240 min), utebliven incheckning (30 min). |
| `BollplockareDayOverride` | Avvikande stängningstid eller stängd dag för ett datum. |
| `GpsWorkArea` | En rad: polygoner (JSON, lista av ringar med `[lat,lng]`) och säkerhetsmarginal i meter. |
| `BollplockareSession` | 1:1 med `WorkTimeEntry`. GPS-status, **senaste** position, verifieringsräknare, paustid, `needsReview`. |
| `GpsPause` | Pauser: start, slut, avstånd, bekräftande position, ogiltigförklaring (`voidedAt`, orsak). |
| `GpsEvent` | Passets historik (append-only). Innehåller aldrig koordinater. |
| `Shift.openEnded` | Pass utan fast sluttid. `startsAt` = tidigaste incheckning, `endsAt` = slutet på arbetsdygnet (06.00 nästa morgon, max 16 h), **inte** en arbetad sluttid. |
| `ShiftSwapRequest.kind/counterShiftId` | Passbyten: `DIRECT`, `OPEN`, `EXCHANGE`, `CHANGE`. |
| `WorkTimeCorrection.detail` | Före/efter för incheckning, utcheckning och paus vid korrigering. |

Databasen skyddar själv: en person kan bara ha **en** pågående GPS-registrering (partiellt unikt index), utcheckning före incheckning nekas,
pauser får inte överlappa eller ha slut före start, historiken är append-only, inställningar och område har giltighetsintervall,
och godkänd GPS-tid kräver att utcheckningen ligger i det förflutna.

### Passets tillstånd
Härleds av `deriveWorkState` ur sparade fakta: *Schemalagt → Inväntar incheckning → Aktivt ⇄ Geografiskt pausat → Slutfört → Kräver granskning → Godkänt*, samt *Avbokat*.
**GPS-status är medvetet ett eget fält** (`INSIDE, MARGIN, VERIFYING, OUTSIDE, UNRELIABLE, MISSING, DENIED`, plus härledd `STALE`). En utebliven GPS-signal ändrar aldrig passets tillstånd.

## 3. Hur GPS-kontrollen fungerar

Webbläsaren skickar en mätning var 15:e sekund under ett pågående pass (`reportPositionAction`). Servern bearbetar den i `evaluateSample`
(`src/modules/bollplockare/domain/tracking.ts`), en ren funktion som är testad i `tests/unit/bollplockare-tracking.test.ts`:

1. **Serverns klocka är den enda tidskällan.** Klientens tidsstämpel används bara för att avgöra om en mätning är *gammal* (> 120 s). En framtida tidsstämpel ignoreras.
2. **Osäkra mätningar är aldrig avvikelser:** noggrannhet sämre än gränsen, gammal mätning, ogiltiga värden och fysiskt omöjliga hopp (> 40 m/s) förkastas som `UNRELIABLE`. Senast accepterade position ändras inte.
3. **Zoner** (`classifyPosition`, avstånd mäts från områdets *yttersta kant*, aldrig från en mittpunkt):
   - Zon 1 `INSIDE`: inom polygonen.
   - Zon 2 `MARGIN`: utanför kanten men inom marginalen. Tiden fortsätter, ingen notis.
   - Zon 3 `OUTSIDE`: utanför marginalen **och hela mätfelet ryms utanför** (`avstånd − noggrannhet > marginal`). Annars räknas det som marginalzon.
4. **Verifiering:** första mätningen i zon 3 ger `VERIFYING`. Tiden pausas först när avvikelsen bestått i minst `verificationSeconds` (30 s) och bekräftats av minst två pålitliga mätningar. En enda mätning inne återställer verifieringen. Ett glapp längre än "gammal position" startar om den.
5. **Paus:** startar vid *första* mätningen utanför (personen var utanför hela verifieringstiden). Pausen sparar tid, avstånd och den bekräftande positionen. Båda parter notifieras en gång.
6. **Återupptagning:** kräver två pålitliga mätningar tillbaka *innanför marginalen minus 10 m* (hysteres, så att man inte pausas och återupptas om och om igen vid gränsen). Pausens slut = första mätningen tillbaka.
7. Pausen är **aldrig definitiv**: Admin kan ogiltigförklara den med anledning, tiden räknas då tillbaka.

### Robusthet
| Situation | Hantering |
|---|---|
| Tillfälligt felaktig position / hopp | Förkastas (`UNRELIABLE`), pausar aldrig. |
| Dålig noggrannhet | `UNRELIABLE`. Nära marginalgränsen med mätfel: marginalzon, aldrig avvikelse. |
| GPS saknas / nekad åtkomst | Status `MISSING`/`DENIED` (loggas en gång). **Tiden räknas som vanligt.** Admin ser "senast verifierad". |
| Ingen internetuppkoppling | Tiden räknas på servern. Klienten visar tydligt "Ingen internetuppkoppling" och skickar direkt när det kommer tillbaka. Verifiering som avbryts av ett glapp startar om. |
| Position inte uppdaterad nyligen | Visas som `STALE` (aldrig som aktuell). Admin får en notis efter 10 min utan verifierad position (ingen paus). |
| Webbläsaren stängs / sidan laddas om | Tillståndet läses från servern. Timern räknas från sparade tidsstämplar (`workedSeconds` från servern), inte från en JavaScript-timer. |
| Låst telefon / bakgrund | Se avsnitt 6. Tiden fortsätter räknas, positionskontrollen blir otillgänglig tills sidan är aktiv igen. |
| Flera flikar/enheter | Radlåsning på sessionen serialiserar rapporter. Unikt index hindrar dubbel incheckning. Dubbel utcheckning ger ett enda avslut. En flik som får `NOT_ACTIVE` laddar om. |
| Glömd utcheckning | Påminnelse till personen och Admin efter 240 min. Passet och tiden **ändras aldrig automatiskt**; passet flaggas för granskning. |
| Pass över midnatt / sommar-vintertid | Tid räknas som skillnad mellan serverns tidpunkter (UTC). Passet hör till startdagen. Testat över båda tidsbytena. |

## 4. Admin: så ställer du in allt

- **Karta och arbetsområde** (`/admin/bollplockare/omrade`): zooma in, klicka för att sätta hörn, dra för att flytta, dubbelklicka på ett hörn för att ta bort det, *Nytt delområde* för flera delar
  (range, bana, parkering m.m.), *Testa position* visar vilken zon en punkt får, *Spara*. Marginalen (30/35/40 m) ställs in och ritas ut.
  Området valideras (minst tre hörn, ingen självkorsning, rimlig storlek) och sparas med versionskontroll.
  Kartan använder Leaflet och OpenStreetMap-brickor (gratis, ingen nyckel, kräver attribution, måttlig användning). Byt `TILE_URL` i `src/components/map/leaflet-base.ts` vid behov.
- **Range & GPS-inställningar** (`/admin/bollplockare/installningar`): stängningstid, incheckningsmarginal, verifieringstid m.m., samt avvikande stängningstid eller **stängd dag** per datum.
  Ändrad stängningstid flyttar tidigaste incheckning för alla kommande pass direkt och bollplockarna får en notis.
- **Planera** (`/admin/bollplockare/planering`, och dra-ett-namn i schemat): flera bollplockare och flera dagar åt gången, återkommande veckodagar, publicera eller utkast. Stängda dagar och dubbelbokningar hoppas över med anledning.
- **Konton** (`/admin/bollplockare/personal`): förnamn, efternamn, e-post och en slumpad personlig kod (12 tecken, Argon2id-hashad, visas en gång). Bollplockaren loggar in med den vanliga inloggningen (Anställd → Som bollplockare).
- **Realtid** (`/admin/bollplockare`): vem som ska arbeta, inte klockat in, arbetar, är pausad, har GPS-problem, är klar; pågående tid; karta; avvikelser; kommande dagar; månadens timmar. Uppdateras var 15:e sekund.
- **Rapporter** (`/admin/rapporter`): filter på anställd, månad, status (alla/kräver granskning/ej godkända/godkända), CSV-export (`;`, decimalkomma, BOM, skydd mot formelinjektion).
  Passets sida (`/admin/bollplockare/pass/<id>`) visar pauser, historik och ändringshistorik, och har Godkänn och Korrigera (anledning krävs; ursprungligt och nytt värde, vem och när sparas).

## 5. Tidsregistrering och lön

Registrerad tid = (utcheckning − incheckning) − pauser, avrundat en gång till hela minuter. Exempel: in 19.45, ut 21.32, paus 5 min → total 107 min, registrerat 102 min (1 h 42 min).
Bara godkänd tid (`approvedMinutes`) ger ersättning: godkänd tid × den timlön som gällde arbetsdagen. En låst månadsrapport kan inte ändras.

## 6. Begränsningar i webbversionen (läs detta)

Systemet är en webbsida, inte en app. Webbläsare ger **ingen garanti** för kontinuerlig GPS i bakgrunden:

- **iOS Safari:** när skärmen låses eller sidan hamnar i bakgrunden pausas JavaScript och platsmätning. Ingen bakgrundsplats för vanliga webbsidor.
- **Android Chrome:** bakgrundsflikar och låst skärm stryps eller stoppas, särskilt med batterisparläge.
- **Wake Lock** (`navigator.wakeLock`) hålls under passet för att hålla skärmen tänd där det stöds, men det garanterar ingenting och drar batteri.
- **Position kan förfalskas** av en användare som styr sin enhet (platsimitation). Servern kan inte avgöra om en mätning är äkta. Skydden (serverns klocka, flera mätningar, Admins granskning) minskar misstag men stoppar inte avsiktlig manipulation.
- **Konsekvens:** när sidan inte är aktiv uteblir mätningarna. Tiden räknas då **som vanligt** (förmånen av tvivel) och Admin ser "senast verifierad position". En paus kan bara uppstå om sidan är aktiv och rapporterar utanför området.

Tillförlitlig bakgrundsspårning kräver en **native-app** (Android foreground service / iOS "Always" location). Den ingår inte. Webbversionen simulerar inte något den inte kan garantera.

## 7. Integritet och arbetsrätt: gör detta innan GPS används med riktig personal

Platsuppgifter om anställda är personuppgifter. Det här är en checklista, inte juridisk rådgivning. Rådgör med jurist/dataskyddsombud och läs IMY:s vägledning om övervakning av anställda.

- **Ändamål och rättslig grund** (GDPR art. 6): beskriv varför platsen kontrolleras (rätt registrerad arbetstid) och varför det är nödvändigt och proportionerligt. Överväg mindre ingripande alternativ.
- **Konsekvensbedömning (DPIA, art. 35)** bör göras. Systematisk övervakning av anställda är en typisk anledning.
- **Information till personalen** (art. 13): innan start. Appen visar en kort förklaring på profilsidan, men en skriftlig information/policy behövs.
- **Fackliga och medbestämmande:** i Sverige kan MBL (information/förhandling) och kollektivavtal kräva samråd innan system för platsövervakning införs. Kontrollera detta med arbetsgivarorganisation/fack.
- **Register över behandlingar (art. 30)** och eventuella personuppgiftsbiträden. OpenStreetMap-brickor hämtas från tredje part när Admin ser kartan (Admins IP-adress syns för den tjänsten, inga personuppgifter om bollplockarna skickas).
- **Lagringstid:** koordinater raderas från pauser efter lagringstiden (30 dygn, ställbart), den enda "senaste position" raderas vid utcheckning, ingen rörelsehistorik sparas. Se till att rutinen körs (se nedan) och motivera tiden.
- **Åtkomst:** bara Admin ser positioner, och bara under ett pågående pass. Åtkomst till pass loggas inte per visning i dag; det kan läggas till om verksamheten kräver det.
- **Ingen automatisk påföljd:** en GPS-avvikelse ger aldrig automatiskt löneavdrag. Admin granskar och kan rätta. Behåll den ordningen.
- **Rätt till insyn och rättelse:** den anställde ser sina egna pass och pauser och kan begära rättelse hos Admin.

## 8. Drift

- **Schemalagda kontroller** (påminnelser, uteblivna incheckningar, GPS-lucka, radering av gamla positioner) körs när Admin eller en bollplockare öppnar sin panel och kan dessutom anropas av en cron-tjänst:
  `curl -X POST -H "Authorization: Bearer $SWEEP_SECRET" https://<adress>/api/internal/sweeps` (kräver `SWEEP_SECRET`, minst 24 tecken; annars 404). Kör minst en gång per kvart, och minst dagligen för att rensa positioner.
- Filer (dagsavslut) ligger i `STORAGE_DIR` (standard `.storage`). Se `.env.example`.

## 9. Testa själv (lokalt, utan att vara på golfbanan)

1. `npm run preview`, öppna `http://localhost:3000` (eller den port som visas). Skapa ett testkonto (bara för- och efternamn).
2. Gå till **/dev/gps**: *Skapa fiktivt testområde* (om du inte ritat ett) och *Skapa testpass idag*. Testpasset får en stängningstid 15 min fram, så incheckning är öppen nu.
3. Logga in som Anställd → *Som bollplockare* (eller *Öppna som bollplockare*). Under klockan finns **GPS-simulering** (endast i förhandsvisningen): välj *Inom området*, tryck *Klocka in*.
4. Välj *Utanför*: efter ca 30–45 s pausas tiden (röd). Välj *Inom området*: efter ca 30 s återupptas den. Prova *Dålig noggrannhet*, *Ingen GPS-signal*, *Plötsligt hopp* och *Gammal mätning*: ingen paus.
5. *Klocka ut*, titta sedan som Admin: **Bollplockare (live)** (karta, notiser i klockan), **Arbetstid & rapporter** och passets sida (godkänn/korrigera).
6. Simuleringen finns bara när `DEV_PREVIEW=1`, `NODE_ENV=development` och databasen är lokal. Hela `/dev` ger 404 i drift, och simuleringspunkterna returneras aldrig av servern utanför förhandsvisning.

### Måste verifieras på en riktig telefon
Webbläsarens platsdialog och noggrannhet, beteendet när skärmen låses och när fliken hamnar i bakgrunden (iOS och Android), batteriåtgång med Wake Lock, mottagning på golfbanan (träd, byggnader), och att området ritat på kartan stämmer med verkligheten (gå längs gränsen och använd *Testa position*).
