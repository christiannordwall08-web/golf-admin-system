import type { Metadata } from "next";
import { LoginPanel } from "../login-panel";

export const metadata: Metadata = { title: "Admin-inloggning" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginPanel audience="ADMIN" next={typeof next === "string" ? next : undefined} />;
}
