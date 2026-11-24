import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workplaceFromSegment } from "@/domain/roles";
import { LoginPanel } from "../../login-panel";

export const metadata: Metadata = { title: "Anställd-inloggning" };

export default async function EmployeeLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ plats: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const workplace = workplaceFromSegment((await params).plats);
  if (!workplace) notFound();
  const { next } = await searchParams;
  return <LoginPanel audience="EMPLOYEE" workplace={workplace} next={typeof next === "string" ? next : undefined} />;
}
