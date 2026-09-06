import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { currentUser } from "@/lib/auth";
import { getSessionOverview } from "@/lib/session/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) redirect("/login");

  const t = await getTranslations("home");
  const overview = await getSessionOverview(db, user.id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("greeting", { name: user.displayName })}
        </h1>
        {/* Deliberately not "you were away for 12 days". */}
        <p className="text-muted-foreground">{t("welcomeBack")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("dueToday")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {overview.displayedDue > 0 ? (
            <>
              {/*
                The capped number, never the real backlog. Seeing "400 due"
                after two weeks away is a debt notice, not a study plan.
              */}
              <p className="text-3xl font-semibold tabular-nums">
                {t("dueTodayCount", { count: overview.displayedDue })}
              </p>
              {overview.hasMoreThanShown ? (
                <p className="text-sm text-muted-foreground">{t("moreLater")}</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">{t("nothingDue")}</p>
          )}

          <Button asChild size="lg" block>
            <Link href="/review">{t("reviewCta")}</Link>
          </Button>
        </CardContent>
      </Card>

      {/*
        Deliberately no "790 new things waiting" counter. A number that large
        reads as a backlog whatever the wording around it says; new material
        arrives through lessons, at the daily limit, and that is enough.
      */}
    </main>
  );
}
