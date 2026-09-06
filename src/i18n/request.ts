import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "./routing";

type Messages = Record<string, unknown>;

/** Deep merge so a key missing from `de` falls back to `en` instead of throwing. */
function mergeMessages(fallback: Messages, primary: Messages): Messages {
  const out: Messages = { ...fallback };
  for (const [key, value] of Object.entries(primary)) {
    const existing = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = mergeMessages(existing as Messages, value as Messages);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function load(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const fallback = await load("en");
  const messages = locale === "en" ? fallback : mergeMessages(fallback, await load(locale));

  return { locale, messages, timeZone: "Europe/Berlin" };
});
