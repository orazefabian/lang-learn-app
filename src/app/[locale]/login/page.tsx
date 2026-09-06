import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await currentUser()) redirect("/");

  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{tApp("name")}</h1>
        <p className="text-muted-foreground">{t("signInSubtitle")}</p>
      </header>
      <LoginForm
        labels={{
          email: t("email"),
          password: t("password"),
          submit: t("submit"),
          pending: t("pending"),
          invalidCredentials: t("invalidCredentials"),
          missingFields: t("missingFields"),
          unexpectedError: t("unexpectedError"),
        }}
      />
    </main>
  );
}
