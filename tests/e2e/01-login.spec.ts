import { expect, test } from "@playwright/test";
import { LEARNER, login } from "./helpers";

/**
 * Getting in.
 *
 * There is no public signup by design, so this also checks that the door is
 * actually shut rather than merely unadvertised.
 */
test("she signs in and lands on her own home screen", async ({ page }) => {
  await login(page, LEARNER);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/hallo/i);
  // Welcome, never "you were away for 12 days".
  await expect(page.getByText(/schön, dass du da bist/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /wiederholen/i }).first()).toBeVisible();
});

test("a wrong password says so and lets her try again", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(LEARNER.email);
  await page.getByLabel("Passwort").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page.getByRole("alert")).toContainText(/stimmt nicht/i);
  await expect(page).toHaveURL(/\/login/);
});

test("signed out, every page sends her to the login", async ({ page }) => {
  for (const path of ["/", "/review", "/lessons", "/progress", "/teacher"]) {
    await page.goto(path);
    await expect(page, `${path} should require a session`).toHaveURL(/\/login/);
  }
});

test("there is no way to sign up", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: /registrieren|konto erstellen|sign up/i })).toHaveCount(
    0,
  );
});
