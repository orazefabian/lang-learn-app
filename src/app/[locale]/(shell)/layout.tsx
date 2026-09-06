import { BottomNav } from "@/components/bottom-nav";
import { requireUser } from "@/lib/auth";

/**
 * The everyday shell: home, lessons list, progress.
 *
 * Review sessions and the lesson player sit outside it on purpose — both are
 * one-thing-at-a-time screens, and navigation on those is an invitation to
 * leave mid-card.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav role={user.role} />
    </div>
  );
}
