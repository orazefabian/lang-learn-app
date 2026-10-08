import { expect, type Page } from "@playwright/test";

/**
 * Shared steps.
 *
 * Selectors go through visible German text and roles rather than test ids: the
 * copy is a real part of this app's design, and a test that keeps passing
 * while the button stops saying anything useful is not much of a test.
 */

export const LEARNER = {
  email: process.env.E2E_LEARNER_EMAIL ?? "lernende@e2e.local",
  password: process.env.E2E_LEARNER_PASSWORD ?? "e2e-learner-password",
};

export const TEACHER = {
  email: process.env.E2E_TEACHER_EMAIL ?? "lehrer@e2e.local",
  password: process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password",
};

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/passwort/i).fill(user.password);
  await page.getByRole("button", { name: /anmelden/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/**
 * Answers one review card, whatever kind it is.
 *
 * The session interleaves exercise types by design, so a test that walked
 * through it assuming one shape would be flaky by Tuesday.
 */
export async function answerOneCard(page: Page): Promise<void> {
  const check = page.getByRole("button", { name: "Prüfen", exact: true });
  const show = page.getByRole("button", { name: "Zeigen", exact: true });

  if (await check.isVisible().catch(() => false)) {
    await page.getByRole("textbox").first().fill("etwas");
    await check.click();
  } else if (await show.isVisible().catch(() => false)) {
    await show.click();
  }

  /*
   * The four ratings only appear once the answer is showing. Each carries a
   * second line — the accessible name is "Nochmal — Nicht gewusst", not
   * "Nochmal" — so these match on the prefix. An exact match silently finds
   * nothing and the test dies waiting for a button that is on the screen.
   */
  const again = page.getByRole("button", { name: /^Nochmal/ });
  await expect(again).toBeVisible();
  await again.click();
}
