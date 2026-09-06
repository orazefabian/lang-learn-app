import { expect, test } from "@playwright/test";
import { LEARNER, TEACHER, login, logout } from "./helpers";

/**
 * "Verstehe ich nicht", end to end.
 *
 * The two rules being checked are the ones that make the feature worth having:
 * asking must not interrupt her session, and the answer has to come back to
 * her attached to the item rather than as a message she reads once.
 */
const QUESTION = `Warum ist das hier so? ${Date.now()}`;
const ANSWER = "Nach „rada bi“ steht der Akkusativ.";

test("she asks from a card without her session pausing", async ({ page }) => {
  await login(page, LEARNER);
  await page.goto("/review");

  const counter = page.getByText(/^\d+ von \d+$/);
  await expect(counter).toBeVisible();

  await page.getByRole("button", { name: "Verstehe ich nicht" }).click();
  await page.getByRole("textbox", { name: "Was ist unklar?" }).fill(QUESTION);
  await page.getByRole("button", { name: "Abschicken" }).click();

  // Confirmed immediately — it is sent optimistically on purpose.
  await expect(page.getByText("Ist notiert. Weiter geht's.")).toBeVisible();
  // And she is still on the same card, not waiting for anything.
  await expect(counter).toBeVisible();
});

test("it arrives in his inbox and he answers it", async ({ page }) => {
  await logout(page);
  await login(page, TEACHER);

  await page.goto("/teacher/inbox");
  const question = page.getByText(QUESTION);
  await expect(question).toBeVisible();

  const card = page.locator("li", { hasText: QUESTION });
  await card.getByRole("textbox").fill(ANSWER);
  await card.getByRole("button", { name: "Abschicken" }).click();

  await expect(page.getByText(/gesendet|abgeschickt/i).first()).toBeVisible();
});

test("the answer comes back to her and stays on the item", async ({ page }) => {
  await logout(page);
  await login(page, LEARNER);

  // The one notification the app has, and it only carries good news.
  await expect(page.getByText("Antworten für dich")).toBeVisible();

  await page.getByRole("link", { name: /ansehen|antworten/i }).first().click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText(QUESTION)).toBeVisible();

  // Seen once, the nudge goes; the answer itself does not.
  await page.goto("/");
  await expect(page.getByText("Antworten für dich")).toHaveCount(0);

  await page.goto("/answers");
  await expect(page.getByText(ANSWER)).toBeVisible();
});
