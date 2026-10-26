import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * `next lint` was removed in Next 16, so this is the ESLint CLI with the
 * config Next ships. `tsc --noEmit` stays the type authority; this catches
 * what a type checker cannot — hook dependency mistakes, async client
 * components, raw <img> and <a> where Next has a better element.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_prev` in useActionState handlers and `_target` in the db Proxy are
      // positional parameters the signature requires, not forgotten variables.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      /*
       * Warnings, not errors, until the components they flag are reworked.
       *
       * These React Compiler rules arrived with ESLint, after the code was
       * written, and they flag real patterns in the recorder, the review
       * session, the login form and the offline provider — the screens that
       * only show their bugs on a phone. Rewriting them inside a tooling change,
       * with nothing to test them on, is how a regression ships. New code should
       * not add to the count; fix the existing ones one component at a time.
       */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated: compiled ops scripts and the harness/test reports.
    "scripts/dist/**",
    "ux-report/**",
    "ux-verify/**",
    "playwright-report/**",
    "test-results/**",
    "media/**",
  ]),
]);
