import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Compares two UX harness snapshots and says what changed, in markdown.
 *
 *   node scripts/ux/axe-diff.mjs ux-verify/before ux-verify/after
 *
 * Usually reached through `scripts/ux/verify.sh diff before after`. The output
 * is meant to be pasted into a pull request as it is, so it leads with what a
 * reviewer needs — what got fixed, what got worse — and folds away what did
 * not move.
 *
 * Screens are matched by name, not by their number in the walk: one extra or
 * missing screen early on would otherwise shift every comparison after it.
 * Counts are of failing elements, not of rules, so "26 → 0" means twenty-six
 * things a person could not read are now readable.
 */

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("usage: node scripts/ux/axe-diff.mjs <before-dir> <after-dir>");
  process.exit(2);
}

function load(dir) {
  if (!existsSync(dir)) {
    console.error(`no snapshot at ${dir}`);
    process.exit(2);
  }
  const scenarios = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const manifest = path.join(dir, entry.name, "manifest.json");
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    const screens = new Map();
    for (const capture of JSON.parse(readFileSync(manifest, "utf8")).captures) {
      // "07-review-answer" → "review-answer"
      screens.set(capture.id.replace(/^\d+-/, ""), capture);
    }
    scenarios.set(entry.name, screens);
  }
  return scenarios;
}

/** Older manifests kept only the first four nodes; prefer the true count. */
const count = (violation) => violation.nodeCount ?? violation.nodes.length;

function failures(capture) {
  const byRule = new Map();
  for (const violation of capture?.axe ?? []) {
    if (violation.id === "axe-failed-to-run") continue;
    byRule.set(violation.id, violation);
  }
  return byRule;
}

const before = load(beforeDir);
const after = load(afterDir);

const scenarios = [...before.keys()].filter((name) => after.has(name)).sort();
const onlyOneSide = [
  ...[...before.keys()].filter((name) => !after.has(name)).map((name) => `\`${name}\` (before only)`),
  ...[...after.keys()].filter((name) => !before.has(name)).map((name) => `\`${name}\` (after only)`),
];

const changed = [];
const unchanged = [];
const newNodes = [];
const newErrors = [];
const screenGaps = [];
const newlyBlocked = [];
const totals = { before: 0, after: 0, screensBefore: 0, screensAfter: 0, blockedBefore: 0, blockedAfter: 0, errorsBefore: 0, errorsAfter: 0 };

for (const scenario of scenarios) {
  const a = before.get(scenario);
  const b = after.get(scenario);

  for (const capture of a.values()) {
    totals.screensBefore += 1;
    if (capture.status === "blocked") totals.blockedBefore += 1;
    totals.errorsBefore += capture.consoleErrors.length + capture.networkFailures.length;
  }
  for (const capture of b.values()) {
    totals.screensAfter += 1;
    if (capture.status === "blocked") totals.blockedAfter += 1;
    totals.errorsAfter += capture.consoleErrors.length + capture.networkFailures.length;
  }

  for (const screen of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const left = a.get(screen);
    const right = b.get(screen);

    if (!left || !right) {
      screenGaps.push(`\`${scenario}/${screen}\` (${left ? "before" : "after"} only)`);
      continue;
    }
    if (right.status === "blocked" && left.status !== "blocked") {
      newlyBlocked.push(`\`${scenario}/${screen}\` — ${right.notes.join("; ") || "the walk could not get past it"}`);
    }

    // Named, not just counted: "5 → 7" sends whoever reads it hunting, and the
    // usual answer — a request racing a sign-in — takes one line to recognise.
    const seen = new Set([...left.consoleErrors, ...left.networkFailures]);
    for (const message of new Set([...right.consoleErrors, ...right.networkFailures])) {
      if (!seen.has(message)) newErrors.push(`\`${scenario}/${screen}\` ${message.replaceAll("`", "'")}`);
    }

    const leftRules = failures(left);
    const rightRules = failures(right);
    for (const rule of [...new Set([...leftRules.keys(), ...rightRules.keys()])].sort()) {
      const was = leftRules.has(rule) ? count(leftRules.get(rule)) : 0;
      const now = rightRules.has(rule) ? count(rightRules.get(rule)) : 0;
      totals.before += was;
      totals.after += now;

      const row = { scenario, screen, rule, was, now };
      if (was === now) {
        unchanged.push(row);
        continue;
      }
      changed.push(row);
      if (now > was) {
        const known = new Set((leftRules.get(rule)?.nodes ?? []).map((html) => html.slice(0, 80)));
        const fresh = (rightRules.get(rule)?.nodes ?? []).filter((html) => !known.has(html.slice(0, 80)));
        for (const html of fresh.slice(0, 2)) newNodes.push(`\`${scenario}/${screen}\` ${rule}: \`${html.replaceAll("`", "'")}\``);
      }
    }
  }
}

const fixed = changed.filter((row) => row.now < row.was);
const worse = changed.filter((row) => row.now > row.was);
const mark = (row) => (row.now === 0 ? " ✅" : row.now < row.was ? " ↓" : " ⚠️");
const table = (rows, withMark) => [
  "| Scenario | Screen | Problem | Before | After |",
  "| -------- | ------ | ------- | -----: | ----: |",
  ...rows.map((row) => `| ${row.scenario} | ${row.screen} | ${row.rule} | ${row.was} | ${row.now}${withMark ? mark(row) : ""} |`),
];

const out = [];
out.push("### Visual verification", "");
out.push(`UX harness, \`${beforeDir}\` against \`${afterDir}\` · scenarios: ${scenarios.map((s) => `\`${s}\``).join(", ") || "none in common"}`, "");

if (changed.length) {
  out.push(...table(changed, true), "");
} else {
  out.push("No accessibility failure changed on any screen.", "");
}

out.push(
  `**Failing elements: ${totals.before} → ${totals.after}** · ${fixed.length} improved · ${worse.length} worse · ${unchanged.length} unchanged`,
  `Screens captured: ${totals.screensBefore} → ${totals.screensAfter} · blocked: ${totals.blockedBefore} → ${totals.blockedAfter} · console/network errors: ${totals.errorsBefore} → ${totals.errorsAfter}`,
);

if (newNodes.length) out.push("", "**New failures:**", ...newNodes.map((line) => `- ${line}`));
if (newlyBlocked.length) out.push("", "**Journeys that no longer complete:**", ...newlyBlocked.map((line) => `- ${line}`));
if (newErrors.length) out.push("", "**Console or network errors not seen before:**", ...newErrors.slice(0, 10).map((line) => `- ${line}`));
if (screenGaps.length) out.push("", `Captured on one side only (not compared): ${screenGaps.join(", ")}`);
if (onlyOneSide.length) out.push("", `Scenarios on one side only (not compared): ${onlyOneSide.join(", ")}`);

if (unchanged.length) {
  out.push("", "<details><summary>Unchanged failures</summary>", "", ...table(unchanged, false), "", "</details>");
}

out.push(
  "",
  "_The review and speaking screens show whichever card the session dealt, so a change there can be a different card rather than a different app. Light mode only._",
);

console.log(out.join("\n"));
