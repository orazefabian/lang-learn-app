import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import "../globals.css";

/**
 * Slovene is set in Fraunces and German in Atkinson Hyperlegible, everywhere.
 * The split is not decoration: it tells her at a glance which language she is
 * looking at, and Atkinson was drawn for legibility, which is what the language
 * she already reads needs.
 *
 * Both are self-hosted by next/font at build time — no request leaves the
 * server at runtime, which the offline mode depends on.
 */
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  // Variable across weight, optical size and Fraunces' own SOFT/WONK axes.
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#25282f" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
    applicationName: t("name"),
    appleWebApp: { capable: true, statusBarStyle: "default", title: t("name") },
    formatDetection: { telephone: false },
  };
}

/**
 * Applied before first paint so a dark-mode user never sees a light flash.
 * Falls back to the system preference when nothing was chosen explicitly.
 */
const themeScript = `(function(){try{var s=localStorage.getItem("theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${fraunces.variable} ${atkinson.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
