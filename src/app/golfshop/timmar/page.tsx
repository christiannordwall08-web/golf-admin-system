import type { Metadata } from "next";
import { EmployeeHours } from "@/components/employee/pages";

export const metadata: Metadata = { title: "Mina timmar" };

export default function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  return <EmployeeHours category="GOLFSHOP" searchParams={searchParams} />;
}
