# End-to-end tests

Six journeys, run against a built app and a real PostgreSQL.

```bash
# A database these tests may destroy — not the one with her actual history.
export DATABASE_URL=postgres://slo:slo@localhost:5432/dober-dan_e2e
export SESSION_SECRET="$(openssl rand -base64 48)"

pnpm db:migrate
pnpm e2e:seed          # two accounts and a small deck, idempotent
pnpm build
pnpm test:e2e
```

`pnpm e2e:seed` creates the accounts the specs log in as, with fixed passwords
(overridable via `E2E_LEARNER_EMAIL` and friends). It refuses to touch a
database that has more content than a seeded one, so it cannot be pointed at
the real deployment by accident.

## Why not PGlite

The other suites use PGlite over its wire protocol, which serves one connection
at a time. A browser talking to a server that is talking to a database is
already more than one, so these need real PostgreSQL. `docker compose up db` is
enough.

## Piper and Whisper

Not required. Without them the listening and speaking exercises are absent
rather than broken, which the app is designed for — but two specs then skip
themselves, because there is nothing to click. Set `PIPER_URL` / `WHISPER_URL`
to exercise them.

The speaking spec never needs a real microphone: Chromium is launched with a
fake capture device, so `getUserMedia` resolves and `MediaRecorder` produces
genuine webm.
