import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) redirect("/login");

  const t = await getTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("greeting", { name: user.displayName })}
        </h1>
        <p className="text-muted-foreground">{t("welcomeBack")}</p>
      </header>

      {/* Filled in at build step 6 — the home screen needs cards and lessons first. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("dueToday")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("nothingDue")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
