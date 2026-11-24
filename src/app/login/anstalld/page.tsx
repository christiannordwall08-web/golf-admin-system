import type { Metadata } from "next";
import { LoginPanel } from "../login-panel";

export const metadata: Metadata = { title: "Anställd-inloggning" };

export default async function EmployeeLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginPanel audience="EMPLOYEE" next={typeof next === "string" ? next : undefined} />;
}
