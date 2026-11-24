import { ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { allowedClosingDates } from "@/domain/daily-closing";
import { formatSek } from "@/domain/money";
import { formatDateLong, formatDateShort, formatTime, localToInstant, stockholmDateOf } from "@/domain/time";
import { requireEmployeeArea } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listMyClosings } from "@/server/services/daily-closing";
import { ClosingForm } from "./closing-form";

export const metadata: Metadata = { title: "Dagsavslut" };

export default async function EmployeeClosingPage() {
  const { session } = await requireEmployeeArea("GOLFSHOP");
  const now = new Date();
  const today = stockholmDateOf(now);
  const dates = allowedClosingDates(today).map((d, i) => ({
    value: d,
    label: `${i === 0 ? "Idag" : i === 1 ? "Igår" : ""}${i < 2 ? " · " : ""}${formatDateLong(localToInstant(d, "12:00"))}`,
  }));
  const mine = await listMyClosings(getDb(), session.user.id);

  return (
    <>
      <PageHeader title="Dagsavslut" description="Ta en bild på dagens avslut och skriv in dagens summa. Det går direkt till administratörerna." />

      <Card>
        <CardContent className="p-5 sm:p-6">
          <ClosingForm dates={dates} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Mina inskickade dagsavslut</CardTitle>
          <CardDescription>Bara dina egna. Du ser när varje avslut skickades och om administratören har granskat det.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {mine.length === 0 ? (
            <EmptyState icon={ImageIcon} title="Du har inte skickat in något dagsavslut ännu" />
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className="min-w-28 font-medium first-letter:uppercase">{formatDateLong(localToInstant(c.workDate, "12:00"))}</span>
                  <span className="tabular-nums">{formatSek(c.dayTotalOre)}</span>
                  <span className="text-ink-muted">Skickat {formatDateShort(c.uploadedAt)} {formatTime(c.uploadedAt)}</span>
                  <Badge tone={c.status === "REVIEWED" ? "success" : "neutral"}>{c.status === "REVIEWED" ? "Granskat" : "Skickat"}</Badge>
                  <a href={`/api/dagsavslut/${c.id}/bild`} target="_blank" rel="noopener noreferrer" className="ml-auto font-medium text-brand-700 hover:underline">
                    Visa bild
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Notice tone="info" className="mt-6">
        Bilden sparas skyddat och kan bara ses av administratörerna och av dig. Skicka bara in avslutet, inga kortuppgifter eller personuppgifter behövs.
      </Notice>
    </>
  );
}
