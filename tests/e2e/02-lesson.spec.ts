import { expect, test } from "@playwright/test";
import { LEARNER, login } from "./helpers";

/**
 * A lesson, start to finish.
 *
 * The thing being checked at the end is not the congratulation screen — it is
 * that finishing put the lesson's items into her deck, which is the whole
 * point of a lesson existing.
 */
test("she works through a lesson and its items land in her deck", async ({ page }) => {
  await login(page, LEARNER);

  await page.goto("/lessons");
  const firstLesson = page.getByRole("link").filter({ hasText: /min/ }).first();
  await expect(firstLesson).toBeVisible();
  await firstLesson.click();

  await expect(page).toHaveURL(/\/lessons\/[^/]+$/);

  // Step through however many cards this lesson has.
  for (let step = 0; step < 40; step += 1) {
    const finish = page.getByRole("button", { name: "Lektion abschließen" });
    if (await finish.isVisible().catch(() => false)) {
      await finish.click();
      break;
    }

    const next = page.getByRole("button", { name: /weiter|nächste/i }).first();
    if (await next.isVisible().catch(() => false)) {
      await next.click();
      continue;
    }

    const check = page.getByRole("button", { name: "Prüfen", exact: true });
    if (await check.isVisible().catch(() => false)) {
      await page.getByRole("textbox").first().fill("etwas");
      await check.click();
      continue;
    }

    break;
  }

  await expect(page.getByText("Fertig.")).toBeVisible();
  // Framed as what she can now practise, never as a score.
  await expect(page.getByText(/in deinen Wiederholungen/i)).toBeVisible();
});
