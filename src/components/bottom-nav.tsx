"use client";

import { BookOpen, GraduationCap, House, MessageSquareQuote } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation, because the whole app is used one-handed on a phone and
 * the top of a phone is the part a thumb cannot reach.
 */
const ITEMS = [
  { href: "/", key: "home", Icon: House },
  { href: "/lessons", key: "lessons", Icon: GraduationCap },
  { href: "/review", key: "review", Icon: BookOpen },
  { href: "/progress", key: "progress", Icon: MessageSquareQuote },
] as const;

export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("home")}
      className="sticky bottom-0 z-10 border-t border-border bg-background/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-[0.7rem] transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="font-medium">{t(key as "home")}</span>
                {/* Never colour alone: the active tab also carries a marker. */}
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-6 rounded-full transition-colors",
                    active ? "bg-primary" : "bg-transparent",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
