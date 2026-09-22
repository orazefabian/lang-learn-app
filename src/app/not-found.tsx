import { Button } from "@/components/ui/button";
import "./globals.css";

/**
 * Next.js only reaches a locale-aware not-found.tsx for a `notFound()` call
 * made *within* that segment (e.g. an invalid locale in `[locale]/layout.tsx`).
 * A URL that simply doesn't match any route — most bad links and bookmarks —
 * is resolved before a locale is ever known, so it always renders this root
 * file instead. There's no `[locale]` param here to translate with, so the
 * copy is hardcoded in German, the app's default and only fallback language.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-lg">Diese Seite gibt es nicht.</p>
      <Button asChild size="lg">
        <a href="/">Start</a>
      </Button>
    </main>
  );
}
