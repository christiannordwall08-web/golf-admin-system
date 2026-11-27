# Lediga pass och smartare passbyten

Inspirerat av Planday: personalen löser själv luckor i schemat, Admin behåller kontrollen. Byggt av Hugo (Admin/Golfshop-sidan).

## Vad finns

| Funktion | Var | Hur |
|---|---|---|
| Lägga ut ett ledigt pass | `/admin/lediga-pass` | Admin väljer grupp, dag, tid och **hur passet tillsätts**: *Först till kvarn* (den första som kan ta det får det direkt) eller *Jag väljer* (personalen anmäler intresse). |
| Notis bara till rätt personer | tjänsten | Bara aktiva i gruppen som **inte redan jobbar då** får notisen `OPEN_SHIFT_POSTED`. |
| Ta passet / anmäla intresse | `/golfshop/lediga-pass` | Ett kort per pass med en stor knapp. Krockar visas som text i stället för knapp. |
| Välja bland anmälningarna | `/admin/lediga-pass/[id]` | "Ge passet". Övriga får nej och en notis. Den som valts får en notis och passet hamnar i schemat. |
| Dra in ett ledigt pass | samma sida | Kräver anledning. Intresseanmälda får en notis. |
| Kollegors öppna passbyten | `/golfshop/lediga-pass` | Öppna förfrågningar (`ShiftSwapRequest` kind `OPEN`) visas i samma lista, länkade till förfrågan. |
| Öppna förfrågningar till rätt kollegor | `swaps.ts` | Notisen går bara till kollegor som kan ta passet (aktiva, rätt grupp, ingen krock). Tidigare gick den till alla i gruppen. |
| Automatiskt godkännande av byten | `/admin/lediga-pass` → Inställningar | Av som standard. På: ett `DIRECT`/`OPEN`-byte godkänns direkt när kollegan tackar ja, med **samma kontroller som när Admin godkänner** (`applySwapApproval`). Bryts en regel går förfrågan till Admin som vanligt. `EXCHANGE` och `CHANGE` avgörs alltid av Admin. |

## Datamodell (`prisma/schema/open-shifts.prisma`)

- `OpenShift` – ett pass **utan** ansvarig. Det är inte en `Shift`, eftersom en `Shift` alltid har en ansvarig (NOT NULL).
  När någon får passet skapas en vanlig `Shift` (publicerad, godkänd av personen, historik med orsak `OPEN_SHIFT`) i **samma
  transaktion** som `OpenShift` sätts till `FILLED` och pekar på den (`filledShiftId`).
- `OpenShiftClaim` – en anmälan per (pass, anställd). `PENDING → ACCEPTED/REJECTED`, eller `WITHDRAWN` (raden återanvänds om man anmäler sig igen).
- `SchedulingSettings` – en rad (`id = "default"`): `autoApproveSwaps`, `openShiftAutoAssignDefault`.
- Nya enum-värden (i slutet): `AssignmentChangeReason.OPEN_SHIFT`, `NotificationType.OPEN_SHIFT_*`.

**Databasgarantier** (handskrivna i migrationen `20261126120000_open_shifts`):

- slut efter start
- `FILLED` ⇔ har `filledShiftId` och `filledAt`; `CANCELLED` ⇔ har `cancelledAt`
- högst **en** antagen anmälan per ledigt pass (exclusion constraint, samma mönster som överlappsskyddet)
- avgjord anmälan har beslutstid
- `SchedulingSettings` kan bara ha en rad

Två som tar samma pass samtidigt: tillsättningen låser med `version` + `status = OPEN`. Den som kommer sist rullas tillbaka
helt (även den `Shift` som hann skapas) och får "Någon annan hann före". Överlapp mot egna pass skyddas dessutom av
`Shift`-tabellens befintliga exclusion constraint.

## Regler för vem som får ta ett pass

Allt finns i en ren funktion: `openShiftEligibility` i `src/domain/open-shifts.ts` (enhetstestad). Den används för notiser,
listor och när någon tar passet, så reglerna kan aldrig skilja sig åt. **Framtida arbetstidsregler** (minderåriga,
dygnsvila, max timmar per vecka) läggs till där.

## Till Christian (bollplockare)

Allt fungerar redan för `BOLLPLOCKARE` i tjänsten: pass utan fast sluttid utgår från rangens stängningstid via
`openEndedWindow(getRangeDay(...))` (bara läsning av din modul, inga ändringar i den). Det som saknas är sidan och menyposten,
som ligger i ditt område:

```tsx
// src/app/bollplockare/lediga-pass/page.tsx
import { EmployeeOpenShiftsPage } from "@/components/open-shifts/employee-open-shifts";
import { requireEmployeeArea, toActor } from "@/server/auth/current-user";

export default async function Page({ searchParams }: { searchParams: Promise<{ klart?: string; fel?: string }> }) {
  const { session } = await requireEmployeeArea("BOLLPLOCKARE");
  return <EmployeeOpenShiftsPage actor={toActor(session)} category="BOLLPLOCKARE" searchParams={await searchParams} />;
}
```

och i `nav-config.ts` under `BOLLPLOCKARE`: `{ href: "/bollplockare/lediga-pass", label: "Lediga pass", icon: "open" }`.

**Ändringar i gemensam kod som påverkar dig:** `swaps.ts` – godkännandet är utbrutet till `applySwapApproval` (samma regler),
och öppna förfrågningar notifierar bara kollegor utan krock. `roles.ts` – nya behörigheter `openshift:claim` (all personal),
`openshift:manage` och `settings:scheduling` (Admin).

## Nästa steg

- Sjukanmälan i appen som automatiskt gör passet ledigt.
- Arbetstidsregler i `openShiftEligibility` (minderåriga först).
- Webbpush, så att notisen om ett ledigt pass når telefonen direkt.
