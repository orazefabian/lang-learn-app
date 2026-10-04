#!/usr/bin/env bash
#
# Builds the app, puts it into each scenario in turn, and walks it on a phone.
#
#   scripts/ux/run-harness.sh                    # every scenario
#   scripts/ux/run-harness.sh steady returning   # only these
#
# Needs DATABASE_URL and SESSION_SECRET in the environment (or a .env), and a
# database it is allowed to destroy — the scenario seeder refuses to touch one
# holding accounts it does not recognise, so pointing this at the real
# deployment fails loudly rather than quietly rewriting her history.
#
# Everything lands in ux-report/<scenario>/.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The pnpm scripts each load .env themselves; this script reads DATABASE_URL and
# friends directly too, so it needs them in its own environment as well.
#
# Fill-in only: a variable already in the environment wins, and a blank value
# in the file means "not set". That is what `node --env-file` does for the pnpm
# scripts, and sourcing the file instead would let a .env quietly override a
# DATABASE_URL a caller set on purpose — scripts/ux/verify.sh does exactly that
# when it points the harness at its own throwaway database.
#
# Written with plain ifs on purpose: under `set -e`, a `[ … ] && export` whose
# test fails leaves a non-zero status behind, and a blank value on the last
# line was enough to end the script before it printed anything.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      value="${value%\"}"
      value="${value#\"}"
      if [ -z "${!key+x}" ] && [ -n "$value" ]; then
        export "$key=$value"
      fi
    fi
  done < .env
fi

SCENARIOS=("$@")
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  SCENARIOS=(fresh steady returning mid-session teacher-busy)
fi

PORT="${UX_PORT:-3210}"
PIPER_PORT="${UX_PIPER_PORT:-5001}"
WHISPER_PORT="${UX_WHISPER_PORT:-5002}"

export PIPER_URL="http://127.0.0.1:${PIPER_PORT}"
export WHISPER_URL="http://127.0.0.1:${WHISPER_PORT}"
export UX_BASE_URL="http://127.0.0.1:${PORT}"

stubs_pid=""
app_pid=""

cleanup() {
  stop_app
  [ -n "$stubs_pid" ] && kill_group "$stubs_pid"
  return 0
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf --noproxy '*' "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "$name never became ready at $url" >&2
  return 1
}

# Each server gets its own process group, because `pnpm start` is three
# processes deep (pnpm → sh → next) and killing only the one whose pid we hold
# orphans the server that is actually listening. That orphan keeps the database
# connection, and the next reseed then waits forever for a connection PGlite
# will never hand over — a hang with no error, which is the worst kind.
start_app() {
  setsid pnpm start --port "$PORT" >"/tmp/ux-app.log" 2>&1 &
  app_pid=$!
  wait_for "${UX_BASE_URL}/api/health" "app"
}

kill_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
}

stop_app() {
  if [ -n "$app_pid" ]; then
    kill_group "$app_pid"
    wait "$app_pid" 2>/dev/null || true
    app_pid=""
  fi
}

echo "==> migrations"
pnpm db:migrate

echo "==> content"
pnpm seed:content --activate

echo "==> speech stubs"
setsid pnpm ux:stubs >"/tmp/ux-stubs.log" 2>&1 &
stubs_pid=$!
wait_for "${PIPER_URL}/health" "piper stub" 20
wait_for "${WHISPER_URL}/health" "whisper stub" 20

# Audio belongs to the content, not to a scenario, so once is enough. Without
# it every listening card reads "no audio yet", which is a true statement about
# an empty media volume and a false one about the app.
echo "==> audio"
pnpm audio:generate

echo "==> build"
pnpm build

for scenario in "${SCENARIOS[@]}"; do
  echo ""
  echo "==> scenario: ${scenario}"
  # The app is stopped while seeding because the development database (PGlite)
  # serves a single connection at a time. Against real PostgreSQL this is
  # merely tidy; against PGlite it is the difference between working and not.
  stop_app
  pnpm ux:seed "$scenario"
  start_app
  pnpm ux:capture -- "--scenario=${scenario}"
done

stop_app
echo ""
echo "reports in ux-report/"
