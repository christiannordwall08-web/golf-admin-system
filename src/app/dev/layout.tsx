import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDevPreviewEnabled } from "@/server/dev-preview";

/** Hela /dev finns bara i lokalt förhandsvisningsläge (se src/server/dev-preview.ts). Annars 404. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!isDevPreviewEnabled()) notFound();
  return <>{children}</>;
}
