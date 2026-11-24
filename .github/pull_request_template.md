## Vad ändras och varför

## Hur är det testat
- [ ] `npm run typecheck && npm run lint && npm test && npm run build`
- [ ] Manuellt i webbläsaren (om gränssnitt ändrats)

## Påverkar det den andra utvecklaren?
- [ ] Databasschema / migration (beskriv, och uppdatera `docs/DATA-MODEL.md`)
- [ ] `src/domain`, `src/server` eller delade komponenter (beskriv beteendeändring)
- [ ] Nej, bara mitt eget område

## Säkerhet
- [ ] Behörighet kontrolleras på servern för alla nya läsningar/skrivningar
- [ ] Inga hemligheter, personuppgifter eller testdata i commit
