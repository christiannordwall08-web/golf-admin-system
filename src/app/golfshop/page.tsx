import type { Metadata } from "next";
import { EmployeeHome } from "@/components/employee/pages";

export const metadata: Metadata = { title: "Start" };

export default function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  return <EmployeeHome category="GOLFSHOP" searchParams={searchParams} />;
}
