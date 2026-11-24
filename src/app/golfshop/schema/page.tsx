import type { Metadata } from "next";
import { EmployeeSchedule } from "@/components/employee/pages";

export const metadata: Metadata = { title: "Mitt schema" };

export default function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  return <EmployeeSchedule category="GOLFSHOP" searchParams={searchParams} />;
}
