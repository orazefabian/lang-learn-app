import { expect, test } from "@playwright/test";
import { LEARNER, login } from "./helpers";

/**
 * Recording a speaking answer.
 *
 * Chromium runs with a fake capture device, so this exercises the real
 * MediaRecorder path without hardware. Skipped when Whisper is not configured,
 * because the exercise is then absent by design rather than broken.
 */
test.describe("speaking", () => {
  test.skip(!process.env.WHISPER_URL, "speaking exercises need WHISPER_URL");

  test("she records an answer and rates it herself", async ({ page }) => {
    await login(page, LEARNER);
    await page.goto("/review");

    // Walk the session until a speaking card comes up.
    let found = false;
    for (let step = 0; step < 25 && !found; step += 1) {
      const record = page.getByRole("button", { name: /aufnehmen/i });
      if (await record.isVisible().catch(() => false)) {
        found = true;
        break;
      }

      const check = page.getByRole("button", { name: "Prüfen", exact: true });
      const show = page.getByRole("button", { name: "Zeigen", exact: true });
      if (await check.isVisible().catch(() => false)) {
        await page.getByRole("textbox").first().fill("etwas");
        await check.click();
      } else if (await show.isVisible().catch(() => false)) {
        await show.click();
      }
      await page.getByRole("button", { name: "Gut", exact: true }).click();
    }

    test.skip(!found, "no speaking card came up in this session");

    await page.getByRole("button", { name: /aufnehmen/i }).click();
    await page.waitForTimeout(1_200);
    await page.getByRole("button", { name: /fertig|stopp/i }).click();

    // Whatever the recogniser makes of it, she is the one who rates the card.
    await expect(page.getByRole("button", { name: "Gut", exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});
