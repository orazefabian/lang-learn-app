import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";

/**
 * Walks the app on a phone and writes down what it saw.
 *
 * This exists because a reviewer that cannot see the app can only review the
 * code, and the two are not the same review. Every state it reaches becomes a
 * PNG plus a row in a manifest: the accessibility violations on that screen,
 * anything the console complained about, any request that failed, and how much
 * of the page fitted above the fold.
 *
 *   pnpm ux:capture -- --scenario=returning
 *
 * The run never fails on a missing selector. A journey that cannot continue is
 * recorded as blocked, with the screenshot of wherever it got stuck, and the
 * walk moves on to the next one — where a journey breaks is a finding, and
 * throwing it away to report a clean exit code would be the wrong trade.
 */

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SCENARIO = arg("scenario", process.env.UX_SCENARIO ?? "steady");
const BASE_URL = arg("base", process.env.UX_BASE_URL ?? "http://127.0.0.1:3210");
const OUT_DIR = path.resolve(arg("out", process.env.UX_OUT_DIR ?? "ux-report"));
const WHISPER_URL = process.env.WHISPER_URL ?? "";

const LEARNER = {
  email: process.env.UX_LEARNER_EMAIL ?? "lernende@ux.local",
  password: process.env.UX_LEARNER_PASSWORD ?? "ux-harness-learner",
};
const TEACHER = {
  email: process.env.UX_TEACHER_EMAIL ?? "lehrer@ux.local",
  password: process.env.UX_TEACHER_PASSWORD ?? "ux-harness-teacher",
};

type AxeFinding = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  /** The offending markup, trimmed — enough to find it, not enough to drown in. */
  nodes: string[];
};

type Capture = {
  id: string;
  title: string;
  /** Why this screen is worth looking at, in the brief's terms. */
  why: string;
  route: string;
  scenario: string;
  status: "ok" | "blocked";
  screenshot: string;
  fullPageScreenshot: string | null;
  viewportHeight: number;
  pageHeight: number;
  notes: string[];
  axe: AxeFinding[];
  consoleErrors: string[];
  networkFailures: string[];
};

const captures: Capture[] = [];
let consoleErrors: string[] = [];
let networkFailures: string[] = [];
let sequence = 0;

function watch(page: Page): void {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  page.on("pageerror", (error) => consoleErrors.push(`uncaught: ${error.message}`.slice(0, 400)));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    /*
     * Next prefetches routes and then cancels them the moment navigation goes
     * elsewhere, which surfaces as ERR_ABORTED on perfectly healthy requests.
     * Reporting those would bury the real failures under a dozen phantoms per
     * screen, and a finding nobody trusts is worse than no finding.
     */
    if (reason.includes("ERR_ABORTED")) return;
    networkFailures.push(`${request.method()} ${request.url()} — ${reason}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
}

/** Accessibility is the part of "is this usable" that a machine can settle. */
async function runAxe(page: Page): Promise<AxeFinding[]> {
  try {
    await page.addScriptTag({ path: AXE_PATH });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe?: { run: (ctx: Document, opts: unknown) => Promise<unknown> } }).axe;
      if (!axe) return [];
      const result = (await axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      })) as {
        violations: {
          id: string;
          impact: string | null;
          help: string;
          helpUrl: string;
          nodes: { html: string }[];
        }[];
      };
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.slice(0, 4).map((node) => node.html.slice(0, 220)),
      }));
    });
    return violations as AxeFinding[];
  } catch (error) {
    return [
      {
        id: "axe-failed-to-run",
        impact: "unknown",
        help: `axe could not run on this page: ${error instanceof Error ? error.message : String(error)}`,
        helpUrl: "",
        nodes: [],
      },
    ];
  }
}

async function shot(
  page: Page,
  id: string,
  title: string,
  why: string,
  options: { status?: "ok" | "blocked"; notes?: string[] } = {},
): Promise<void> {
  sequence += 1;
  const slug = `${String(sequence).padStart(2, "0")}-${id}`;
  const file = `${slug}.png`;

  // Fonts and any entry animation want a moment; a screenshot taken mid-fade
  // looks like a rendering bug and would be filed as one.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, SCENARIO, file) });

  const metrics = await page
    .evaluate(() => ({
      viewportHeight: window.innerHeight,
      pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    }))
    .catch(() => ({ viewportHeight: 0, pageHeight: 0 }));

  /*
   * A second, whole-page image when the screen does not fit. What sits below
   * the fold on a phone is exactly the kind of thing this harness exists to
   * show, and the viewport shot alone would hide it.
   */
  let fullPage: string | null = null;
  if (metrics.pageHeight > metrics.viewportHeight + 40) {
    fullPage = `${slug}-full.png`;
    await page
      .screenshot({ path: path.join(OUT_DIR, SCENARIO, fullPage), fullPage: true })
      .catch(() => {
        fullPage = null;
      });
  }

  captures.push({
    id: slug,
    title,
    why,
    route: new URL(page.url()).pathname,
    scenario: SCENARIO,
    status: options.status ?? "ok",
    screenshot: file,
    fullPageScreenshot: fullPage,
    viewportHeight: metrics.viewportHeight,
    pageHeight: metrics.pageHeight,
    notes: options.notes ?? [],
    axe: await runAxe(page),
    consoleErrors: [...consoleErrors],
    networkFailures: [...networkFailures],
  });

  consoleErrors = [];
  networkFailures = [];
  console.log(`  ${slug}  ${title}`);
}

/** Runs a journey, and turns a failure into a recorded observation. */
async function journey(name: string, page: Page, steps: () => Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  try {
    await steps();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ! blocked: ${message.split("\n")[0]}`);
    await shot(page, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-blocked`, `${name} — blocked`, "The walk could not continue here. Where a journey stops is itself a finding.", {
      status: "blocked",
      notes: [`blocked: ${message.split("\n").slice(0, 3).join(" ")}`],
    }).catch(() => undefined);
  }
}

async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto(`${BASE_URL}/de/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/passwort/i).fill(user.password);
  await page.getByRole("button", { name: /anmelden/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Tell the Whisper stub what to "hear" next, so a band can be chosen. */
async function setTranscript(target: string, mode: "good" | "close" | "off" | "empty"): Promise<boolean> {
  if (!WHISPER_URL) return false;
  try {
    const response = await fetch(new URL("/__control", WHISPER_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, mode }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Advances the review session until a card of the wanted shape comes up.
 * The session interleaves exercise types on purpose, so the only way to reach
 * a speaking card is to walk there.
 */
async function advanceTo(page: Page, want: "speaking" | "any", limit = 30): Promise<boolean> {
  for (let step = 0; step < limit; step += 1) {
    const record = page.getByRole("button", { name: /aufnehmen/i }).first();
    if (await record.isVisible().catch(() => false)) {
      if (want === "speaking") return true;
    }
    if (want === "any") return true;

    // The rating buttons carry a second line ("Gut — Gewusst"), so they are
    // matched on the prefix. An exact match finds nothing, which is the trap
    // the e2e helper fell into.
    const rate = page.getByRole("button", { name: /^Gut/ });
    if (await rate.isVisible().catch(() => false)) {
      await rate.click();
      await page.waitForTimeout(400);
      continue;
    }

    const check = page.getByRole("button", { name: "Prüfen", exact: true });
    const show = page.getByRole("button", { name: "Zeigen", exact: true });
    if (await check.isVisible().catch(() => false)) {
      if (await page.getByRole("textbox").count()) {
        await page.getByRole("textbox").first().fill("etwas");
      }
      await check.click();
    } else if (await show.isVisible().catch(() => false)) {
      await show.click();
    } else {
      return false;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function record(page: Page, seconds = 1.2): Promise<void> {
  await page.getByRole("button", { name: /aufnehmen/i }).first().click();
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole("button", { name: /^fertig$|stopp/i }).first().click();
  // Scoring is a round trip through the server and the recogniser.
  await page.waitForTimeout(2500);
}

/* -------------------------------------------------------------------- run */

await rm(path.join(OUT_DIR, SCENARIO), { recursive: true, force: true });
await mkdir(path.join(OUT_DIR, SCENARIO), { recursive: true });

const browser = await chromium.launch({
  ...(process.env.UX_CHROMIUM_PATH ? { executablePath: process.env.UX_CHROMIUM_PATH } : {}),
  args: [
    "--no-sandbox",
    // A silent synthetic microphone, the same trick the e2e suite uses: real
    // MediaRecorder output, no hardware, no permission prompt.
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const context: BrowserContext = await browser.newContext({
  ...devices["Pixel 7"],
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
  permissions: ["microphone"],
});
const page = await context.newPage();
watch(page);

console.log(`scenario ${SCENARIO} against ${BASE_URL}`);

await journey("Signed out", page, async () => {
  await page.goto(`${BASE_URL}/de/login`, { waitUntil: "domcontentloaded" });
  await shot(page, "login", "Login", "The first screen anyone meets, and the only one a signed-out person can reach.");

  await page.getByLabel(/e-?mail/i).fill(LEARNER.email);
  await page.getByLabel(/passwort/i).fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: /anmelden/i }).click();
  await page.waitForTimeout(1200);
  await shot(page, "login-error", "Login — wrong password", "Error recovery on a phone: is the email still there, and where did focus go?");

  await page.goto(`${BASE_URL}/de/diese-seite-gibt-es-nicht`, { waitUntil: "domcontentloaded" });
  await shot(page, "not-found", "404", "A stale bookmark or a mistyped path — does it stay in German and in the design?");
});

await journey("Home", page, async () => {
  await signIn(page, LEARNER);
  await shot(page, "home", "Home", "Principle 1 and 3 both land here: what she is greeted with, and what number she is shown.");
});

await journey("Review", page, async () => {
  await page.goto(`${BASE_URL}/de/review`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await shot(page, "review-start", "Review — first card", "The session the backlog cap produces. Nothing here may report the true backlog.");

  const show = page.getByRole("button", { name: "Zeigen", exact: true });
  const check = page.getByRole("button", { name: "Prüfen", exact: true });
  if (await check.isVisible().catch(() => false)) {
    await page.getByRole("textbox").first().fill("dober dan");
    await check.click();
    await page.waitForTimeout(600);
    await shot(page, "review-checked", "Review — answer checked", "How a typed answer is judged, and how a wrong one is spoken about.");
  } else if (await show.isVisible().catch(() => false)) {
    await show.click();
    await page.waitForTimeout(600);
    await shot(page, "review-revealed", "Review — answer revealed", "The rating step: four choices, and how much reading they need.");
  }

  const stuck = page.getByRole("button", { name: "Verstehe ich nicht" });
  if (await stuck.isVisible().catch(() => false)) {
    await stuck.click();
    await page.waitForTimeout(800);
    await shot(page, "review-ask", "Review — asking a question", "The way out of being stuck. Filing one must never block the session.");
    await page.keyboard.press("Escape").catch(() => undefined);
  }
});

await journey("Speaking", page, async () => {
  await page.goto(`${BASE_URL}/de/review`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const reached = await advanceTo(page, "speaking");
  if (!reached) {
    await shot(page, "speaking-absent", "Speaking — not reached", "Speaking is the first skill the brief names. Not reaching one is itself worth knowing.", {
      status: "blocked",
      notes: ["No speaking card came up within 30 steps. Check WHISPER_URL and the exercise mix."],
    });
    return;
  }

  await shot(page, "speaking-prompt", "Speaking — before recording", "What she is asked to say, and how obvious the recording control is.");

  // Band by band. The Slovene target is only revealed after the first attempt,
  // so the first pass is the one that cannot know it — hence "off".
  await setTranscript("", "off");
  await record(page);
  await shot(page, "speaking-off", "Speaking — not understood", "The worst outcome. The brief is emphatic that this must not read as a verdict on her.");

  const revealed = (await page.locator("p.text-2xl").last().textContent().catch(() => ""))?.trim() ?? "";

  const retry = page.getByRole("button", { name: /nochmal aufnehmen/i });
  if (revealed && (await retry.isVisible().catch(() => false))) {
    await setTranscript(revealed, "close");
    await retry.click();
    await page.waitForTimeout(500);
    await record(page);
    await shot(page, "speaking-close", "Speaking — close", "One ending wrong, which in Slovene is the common case and should read as encouragement.");

    const retryAgain = page.getByRole("button", { name: /nochmal aufnehmen/i });
    if (await retryAgain.isVisible().catch(() => false)) {
      await setTranscript(revealed, "good");
      await retryAgain.click();
      await page.waitForTimeout(500);
      await record(page);
      await shot(page, "speaking-good", "Speaking — understood", "The reward state. Worth checking it feels like one.");
    }
  }
});

await journey("Lessons", page, async () => {
  await page.goto(`${BASE_URL}/de/lessons`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await shot(page, "lessons", "Lessons", "Thirty-nine lessons on a phone: can she tell where she is and what is next?");

  const firstLesson = page.getByRole("link").filter({ hasText: /\w/ }).nth(2);
  if (await firstLesson.isVisible().catch(() => false)) {
    await firstLesson.click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await shot(page, "lesson-player", "Lesson", "The teaching surface itself, and whether resuming mid-lesson is obvious.");
  }
});

await journey("Progress", page, async () => {
  await page.goto(`${BASE_URL}/de/progress`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await shot(page, "progress", "What I can say", "Progress as capability, not as a counter. The brief's replacement for streaks.");

  await page.goto(`${BASE_URL}/de/answers`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await shot(page, "answers", "Answers", "Where a teacher's answer lands, and whether it reads as a reply to her question.");
});

await journey("Offline", page, async () => {
  await page.goto(`${BASE_URL}/de/review`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline"))).catch(() => undefined);
  await page.waitForTimeout(1200);
  await shot(page, "offline-warm", "Offline — tab already open", "The promise is that a session survives the train. This is the easy half of it.");

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(1200);
  await shot(page, "offline-cold", "Offline — reopened", "The hard half: a cold open with no connection, which is what the PWA shortcut does.");
  await context.setOffline(false);
});

await journey("Teacher", page, async () => {
  await context.clearCookies();
  await signIn(page, TEACHER);
  await page.goto(`${BASE_URL}/de/teacher`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await shot(page, "teacher-hub", "Teacher", "His half of the app, on his own phone, sitting next to her.");

  for (const [route, title, why] of [
    ["inbox", "Teacher — inbox", "Questions waiting on him. The digest must not become the only way he finds out."],
    ["drafts", "Teacher — drafts", "The approval gate. Nothing reaches her deck without passing through this screen."],
    ["content", "Teacher — content", "Browsing and fixing the deck itself."],
    ["digest", "Teacher — digest", "The weekly summary, which is explicitly not allowed to become a nag."],
  ] as const) {
    await page.goto(`${BASE_URL}/de/teacher/${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await shot(page, `teacher-${route}`, title, why);
  }
});

/* ----------------------------------------------------------------- report */

const axeTotal = captures.reduce((sum, capture) => sum + capture.axe.length, 0);
const blocked = captures.filter((capture) => capture.status === "blocked");
const withErrors = captures.filter((capture) => capture.consoleErrors.length || capture.networkFailures.length);

await writeFile(
  path.join(OUT_DIR, SCENARIO, "manifest.json"),
  `${JSON.stringify({ scenario: SCENARIO, baseUrl: BASE_URL, capturedAt: new Date().toISOString(), captures }, null, 2)}\n`,
);

const lines = [
  `# UX capture — ${SCENARIO}`,
  "",
  `${captures.length} states · ${axeTotal} accessibility violations · ${blocked.length} blocked · ${withErrors.length} with console or network errors`,
  "",
  "| # | State | Why it matters | Fold | axe | errors |",
  "| - | ----- | -------------- | ---- | --- | ------ |",
  ...captures.map((capture) => {
    const fold = capture.pageHeight > capture.viewportHeight + 40 ? `${Math.round((capture.viewportHeight / capture.pageHeight) * 100)}% visible` : "fits";
    const errors = capture.consoleErrors.length + capture.networkFailures.length;
    return `| ${capture.id} | ${capture.status === "blocked" ? "⚠ " : ""}${capture.title} | ${capture.why} | ${fold} | ${capture.axe.length} | ${errors || ""} |`;
  }),
  "",
  "Screenshots are beside this file. `manifest.json` has the full axe findings,",
  "console errors and failed requests per state.",
  "",
];
await writeFile(path.join(OUT_DIR, SCENARIO, "README.md"), `${lines.join("\n")}\n`);

console.log(`\n${captures.length} states → ${path.join(OUT_DIR, SCENARIO)}`);
console.log(`${axeTotal} axe violations · ${blocked.length} blocked · ${withErrors.length} with errors`);

await context.close();
await browser.close();
process.exit(0);
