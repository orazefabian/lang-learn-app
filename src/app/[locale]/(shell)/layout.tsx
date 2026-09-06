import { BottomNav } from "@/components/bottom-nav";

/**
 * The everyday shell: home, lessons list, progress.
 *
 * Review sessions and the lesson player sit outside it on purpose — both are
 * one-thing-at-a-time screens, and navigation on those is an invitation to
 * leave mid-card.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav />
    </div>
  );
}
