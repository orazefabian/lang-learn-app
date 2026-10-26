import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import en from "../../messages/en.json";

/**
 * The two message catalogs must stay in step.
 *
 * German is what she reads; English is the fallback `src/i18n/request.ts`
 * merges underneath it. A key missing from `de` therefore does not crash — it
 * quietly shows her English, which is exactly the failure nobody notices in a
 * diff. A placeholder that exists in one language and not the other is worse:
 * the sentence renders with a hole in it, or next-intl throws at runtime.
 */

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/**
 * Argument names in an ICU message: `{name}`, `{count, plural, ...}`.
 *
 * Plural branches (`=1 {eine Lektion}`, `other {Sachen}`) are text, not
 * arguments, so a brace that follows a branch selector is skipped.
 */
function argumentsOf(message: string): string[] {
  const pattern = /(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{\s*([A-Za-z_]\w*)\s*[,}]/g;
  return [...new Set([...message.matchAll(pattern)].map((match) => match[1]!))].sort();
}

const german = flatten(de as Messages);
const english = flatten(en as Messages);

describe("message catalogs", () => {
  it("define the same keys in German and English", () => {
    const missingInEnglish = [...german.keys()].filter((key) => !english.has(key));
    const missingInGerman = [...english.keys()].filter((key) => !german.has(key));

    expect(missingInGerman, "keys that would show her English").toEqual([]);
    expect(missingInEnglish, "keys with no fallback").toEqual([]);
  });

  it("use the same arguments for every key in both languages", () => {
    const mismatched = [...german.entries()]
      .filter(([key]) => english.has(key))
      .map(([key, value]) => ({
        key,
        de: argumentsOf(value),
        en: argumentsOf(english.get(key)!),
      }))
      .filter((entry) => entry.de.join() !== entry.en.join());

    expect(mismatched).toEqual([]);
  });

  it("have no empty strings", () => {
    const empty = [...german, ...english].filter(([, value]) => value.trim() === "");
    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it("extracts ICU arguments but not plural branch text", () => {
    expect(argumentsOf("Hallo, {name}")).toEqual(["name"]);
    expect(
      argumentsOf("{count, plural, =1 {eine Lektion} other {# Lektionen}} von {total}"),
    ).toEqual(["count", "total"]);
    expect(argumentsOf("{count, plural, =1 {Sache} other {Sachen}}")).toEqual(["count"]);
  });
});
