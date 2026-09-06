import { defineConfig, devices } from "@playwright/test";

/**
 * The critical-path suite.
 *
 * Six journeys, the ones the brief names: logging in, finishing a lesson,
 * doing a review, recording a speaking answer, capturing something as the
 * teacher, and asking a question and getting it answered. They are the paths
 * where a regression would be noticed by a person rather than a test.
 *
 * A real Postgres is required — PGlite serves one connection at a time and a
 * browser session plus the server is already two. See tests/e2e/README.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Sessions, cards and the teacher inbox are shared state in one database;
  // running the files in parallel would have them grading each other's cards.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // A phone, because that is what she uses.
    ...devices["Pixel 7"],
    // Speaking exercises need a microphone that never asks.
    permissions: ["microphone"],
  },

  projects: [
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            // A silent synthetic microphone: getUserMedia resolves, MediaRecorder
            // produces real webm, and no hardware is involved.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
