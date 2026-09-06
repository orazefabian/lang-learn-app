import { expect, test } from "@playwright/test";
import { LEARNER, TEACHER, login, logout } from "./helpers";

/**
 * Quick capture.
 *
 * The signature feature, and the test is shaped like the moment it is for:
 * type the Slovene, save, done. Everything else is optional and stays folded
 * away.
 */
const CAPTURED = `Pridi jest, ${Date.now()}`;

test("he captures a phrase with only the Slovene filled in", async ({ page }) => {
  await login(page, TEACHER);
  await page.goto("/teacher");

  await page.getByLabel("Slowenisch").fill(CAPTURED);
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByText(new RegExp(CAPTURED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeVisible();
  // No priority boost, no deadline: it joins the pile like anything else.
  await expect(page.getByText(/keine Sonderbehandlung/i)).toBeVisible();
});

test("the captured phrase is findable in the content browser", async ({ page }) => {
  await login(page, TEACHER);
  await page.goto("/teacher/content");

  await page.getByLabel(/suchen/i).fill(CAPTURED.slice(0, 10));
  await page.keyboard.press("Enter");

  await expect(page.getByText(CAPTURED)).toBeVisible();
});

test("the learner cannot reach the teacher area at all", async ({ page }) => {
  await logout(page);
  await login(page, LEARNER);

  for (const path of ["/teacher", "/teacher/content", "/teacher/inbox", "/teacher/digest"]) {
    await page.goto(path);
    await expect(page, `${path} must turn a learner away`).not.toHaveURL(new RegExp(path));
  }
});
