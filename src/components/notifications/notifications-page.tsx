import { Bell } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateShort, formatTime } from "@/domain/time";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { listMyNotifications } from "@/server/services/notifications";
import { markAllReadAction } from "./actions";

/** Mina notiser. `userId` kommer från den inloggade sessionen (anroparen har redan kontrollerat inloggningen). */
export async function NotificationsPage({ userId }: { userId: string }) {
  const items = await listMyNotifications(getDb(), userId);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title="Notiser"
        description={unread > 0 ? `${unread} olästa` : "Du har läst allt"}
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <SubmitButton variant="secondary" pendingText="Markerar…">Markera alla som lästa</SubmitButton>
            </form>
          ) : null
        }
      />
      {items.length === 0 ? (
        <Card><EmptyState icon={Bell} title="Inga notiser ännu">Här visas passbyten, dagsavslut och annat som kräver din uppmärksamhet.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const inner = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                    {n.body ? <span className="block text-sm text-ink-muted">{n.body}</span> : null}
                  </span>
                  <time dateTime={n.createdAt.toISOString()} className="shrink-0 text-xs whitespace-nowrap text-ink-muted tabular-nums">
                    {formatDateShort(n.createdAt)} {formatTime(n.createdAt)}
                  </time>
                </>
              );
              // Vanlig länk: GET markerar som läst och omdirigerar, så den ska inte förhämtas.
              return (
                <li key={n.id}>
                  <a href={`/notiser/${n.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-brand-50/50">{inner}</a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
