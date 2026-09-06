import { BottomNav } from "@/components/bottom-nav";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { getInboxCounts } from "@/lib/questions/service";

/**
 * The everyday shell: home, lessons list, progress.
 *
 * Review sessions and the lesson player sit outside it on purpose — both are
 * one-thing-at-a-time screens, and navigation on those is an invitation to
 * leave mid-card.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const inbox = user.role === "teacher" ? await getInboxCounts(db) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav role={user.role} openQuestions={inbox?.open ?? 0} />
    </div>
  );
}
