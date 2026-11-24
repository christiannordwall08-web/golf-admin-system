import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { stockholmDateOf } from "@/domain/time";
import { requireAdminArea, toActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listSchedulableEmployees } from "@/server/queries/shift-edit";
import { ShiftForm } from "../shift-form";

export const metadata: Metadata = { title: "Nytt pass" };

export default async function NewShiftPage({ searchParams }: { searchParams: Promise<{ datum?: string; kat?: string; person?: string }> }) {
  const session = await requireAdminArea();
  const sp = await searchParams;
  const employees = await listSchedulableEmployees(getDb(), toActor(session));

  const date = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : stockholmDateOf(new Date());
  const wanted = sp.kat === "bollplockare" ? "BOLLPLOCKARE" : sp.kat === "golfshop" ? "GOLFSHOP" : null;
  const employeeId =
    employees.find((e) => e.id === sp.person)?.id ?? employees.find((e) => e.category === wanted)?.id ?? employees[0]?.id ?? "";
  const back = `/admin/schema${sp.kat ? `?kat=${encodeURIComponent(sp.kat)}` : ""}`;

  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Schema
      </Link>
      <PageHeader title="Nytt pass" description="Välj person, dag och tider. Reglerna (överlapp, arbetsgrupp) kontrolleras när du sparar." />
      <Card className="max-w-2xl">
        <CardContent className="p-5">
          <ShiftForm
            mode="create"
            employees={employees}
            defaults={{ employeeId, date, from: "09:00", to: "17:00", endsNextDay: false, notes: "", publish: false }}
            cancelHref={back}
          />
        </CardContent>
      </Card>
    </>
  );
}
