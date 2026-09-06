import { build } from "esbuild";
import path from "node:path";

/**
 * Compiles the operational scripts to plain JavaScript.
 *
 * The production image has no tsx — Next only traces what the server imports,
 * and a TypeScript loader is not that. Without this step the deployed app can
 * create its two accounts and nothing else: no seeding the deck, no generating
 * audio onto the media volume, which is the one job that has to run in the
 * cluster because that volume only exists there.
 *
 * Application code is inlined; real packages stay external and resolve from
 * the traced node_modules at runtime.
 *
 *   pnpm ops:build   →   scripts/dist/*.mjs
 */
const ENTRIES = [
  "scripts/seed-content.ts",
  "scripts/generate-cards.ts",
  "scripts/generate-audio.ts",
  "scripts/run-digest.ts",
];

await build({
  entryPoints: ENTRIES,
  outdir: "scripts/dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Anything from node_modules is left alone; the image already has the ones
  // the server itself uses, which is the same set these need.
  packages: "external",
  alias: { "@": path.resolve("src") },
  logLevel: "warning",
});

console.log(`compiled ${ENTRIES.length} scripts to scripts/dist/`);
