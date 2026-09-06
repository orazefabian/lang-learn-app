import { expect, test } from "@playwright/test";
import { LEARNER, answerOneCard, login } from "./helpers";

/**
 * A review session.
 *
 * Two of these tests are really about the design rules rather than the
 * mechanics: the backlog is capped and never dumped, and the session is
 * resumable because its state lives on the server.
 */
test("she reviews a few cards and the progress moves", async ({ page }) => {
  await login(page, LEARNER);
  await page.goto("/review");

  const counter = page.getByText(/^\d+ von \d+$/);
  await expect(counter).toBeVisible();
  const before = await counter.textContent();

  await answerOneCard(page);

  await expect(counter).not.toHaveText(before ?? "");
});

/** The rule the whole app is built around: never "400 fällig". */
test("the home screen never shows an uncapped backlog", async ({ page }) => {
  await login(page, LEARNER);

  const due = page.getByText(/^\d+ Karten$/).first();
  if (await due.isVisible().catch(() => false)) {
    const text = (await due.textContent()) ?? "";
    const count = Number.parseInt(text, 10);
    // The cap is a user setting; 20 is the default and nothing may exceed it.
    expect(count).toBeLessThanOrEqual(20);
  }

  // No streak, no guilt, nothing about days missed.
  await expect(page.getByText(/streak|tage in folge|verpasst/i)).toHaveCount(0);
});

test("leaving mid-session and coming back resumes the same card", async ({ page }) => {
  await login(page, LEARNER);
  await page.goto("/review");

  const counter = page.getByText(/^\d+ von \d+$/);
  await expect(counter).toBeVisible();
  await answerOneCard(page);

  const position = await counter.textContent();

  // Closing the app mid-session must lose nothing: the queue and the cursor
  // live in the database, not in the tab.
  await page.goto("/");
  await page.goto("/review");

  await expect(counter).toHaveText(position ?? "");
});

test("every card offers a way out of being stuck", async ({ page }) => {
  await login(page, LEARNER);
  await page.goto("/review");

  await expect(page.getByRole("button", { name: "Verstehe ich nicht" })).toBeVisible();
});
