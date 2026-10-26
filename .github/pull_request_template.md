<!-- Closes #N -->

<!--
What was wrong or missing, and why this is the fix. Prose, not a file list.
Mention anything deliberately left alone.
-->

### Visual verification

<!--
UI changes: paste `pnpm ux:verify diff before after` and name the screenshot
that shows the change. Not a UI change: delete this section.
-->

### Not verified

<!-- Anything you could not run — a browser, a container, a real API call. "Nothing" is a valid answer. -->

### Checklist

- [ ] `pnpm check` passes; `pnpm test:integration` too if `src/lib`, `src/db` or `drizzle/` changed
- [ ] New behaviour has a test; README section updated if behaviour changed
- [ ] Copy in both `messages/de.json` and `messages/en.json`, no hardcoded strings
- [ ] No streaks, goals or guilt copy; no learner-facing due count above the cap
- [ ] AI content still lands as draft; human recordings still win over TTS
- [ ] Works with Piper / Whisper / Anthropic absent
- [ ] Migrations are additive (or the destructive one is acknowledged and explained above)
