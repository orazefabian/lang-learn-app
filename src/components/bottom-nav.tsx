"use client";

import { BookText, Route, Sun, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation, because the whole app is used one-handed on a phone and
 * the top of a phone is the part a thumb cannot reach.
 *
 * Three places, not four: reviewing is something she *starts* from Heute, a
 * full-screen session with its own way out, not a place she browses to.
 */
const LEARNER_ITEMS = [
  { href: "/", key: "home", Icon: Sun },
  { href: "/lessons", key: "lessons", Icon: Route },
  { href: "/progress", key: "progress", Icon: BookText },
] as const;

/**
 * The teacher sees everything the learner sees, plus one more tab. Same app,
 * same URL — so he can sit next to her and switch views on his own phone.
 */
const TEACHER_ITEM = { href: "/teacher", key: "teacher", Icon: PenLine } as const;

export function BottomNav({
  role,
  openQuestions = 0,
}: {
  role: "learner" | "teacher";
  /** Unanswered questions, badged on the teacher tab. */
  openQuestions?: number;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const items = role === "teacher" ? [...LEARNER_ITEMS, TEACHER_ITEM] : LEARNER_ITEMS;

  return (
    <nav
      aria-label={t("label")}
      className="sticky bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch px-2 pt-1.5">
        {items.map(({ href, key, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-13 flex-col items-center justify-center gap-1 px-1 py-1 text-xs font-semibold transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Never colour alone: the active tab also gets a filled pill. */}
                <span
                  className={cn(
                    "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary-soft",
                  )}
                >
                  <Icon className="size-[22px]" aria-hidden />
                  {key === "teacher" && openQuestions > 0 ? (
                    <span className="absolute -top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[0.6rem] font-bold tabular-nums text-accent-foreground">
                      {openQuestions > 9 ? "9+" : openQuestions}
                    </span>
                  ) : null}
                </span>
                <span>{t(key as "home")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
