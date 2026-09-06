import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  const tNav = await getTranslations("nav");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-lg">{t("notFound")}</p>
      <Button asChild size="lg">
        <Link href="/">{tNav("home")}</Link>
      </Button>
    </main>
  );
}
