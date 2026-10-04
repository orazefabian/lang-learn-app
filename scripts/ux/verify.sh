#!/usr/bin/env bash
#
# A before/after look at a change, built on the UX harness.
#
#   scripts/ux/verify.sh snapshot before steady    # before changing anything
#   …make the change…
#   scripts/ux/verify.sh snapshot after steady
#   scripts/ux/verify.sh diff before after         # markdown, for a PR description
#
# The tests can tell whether a change broke the code; they cannot tell whether
# the screen it was meant to fix now looks right. This can, at least for the
# part a machine can settle: which accessibility failures went away, which ones
# appeared, and which journeys stopped completing. The screenshots are beside
# the numbers for the rest.
#
# Snapshots land in ux-verify/<name>/<scenario>/, which is gitignored.
#
# It needs no database of its own. If DATABASE_URL is set — in the environment
# or in .env — it uses that, and the scenario seeder's guard still refuses any
# database holding accounts it does not recognise. If it is not set, a
# throwaway PGlite is started for the length of the snapshot and deleted after,
# which is what makes this runnable in a CI job that has no Postgres service.
set -euo pipefail

cd "$(dirname "$0")/../.."

usage() {
  sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# What the environment or .env says, with the environment winning — the same
# order run-harness.sh and `node --env-file` use.
setting() {
  local key="$1"
  if [ -n "${!key:-}" ]; then printf '%s' "${!key}"; return; fi
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*${key}=\(.*\)$/\1/p" .env | tail -n 1 | sed 's/^"//; s/"$//'
}

db_pid=""
db_dir=""
cleanup() {
  if [ -n "$db_pid" ]; then
    kill -TERM -- "-$db_pid" 2>/dev/null || kill -TERM "$db_pid" 2>/dev/null || true
    wait "$db_pid" 2>/dev/null || true
  fi
  [ -n "$db_dir" ] && rm -rf "$db_dir"
  return 0
}
trap cleanup EXIT

start_throwaway_db() {
  local port="${UX_VERIFY_DB_PORT:-54329}"
  db_dir="$(mktemp -d)"
  DEV_DB_PORT="$port" DEV_DB_DIR="$db_dir/data" setsid node scripts/dev-db.mjs >"$db_dir/db.log" 2>&1 &
  db_pid=$!

  for _ in $(seq 1 30); do
    if node -e "require('net').connect($port,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
      export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${port}/postgres"
      # PGlite serves one connection at a time; run-harness.sh already stops the
      # app around every reseed for exactly this reason.
      export DB_POOL_MAX=1
      echo "==> throwaway database on port ${port}"
      return 0
    fi
    sleep 1
  done
  echo "the throwaway database never came up:" >&2
  cat "$db_dir/db.log" >&2
  exit 1
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  snapshot)
    name="${1:-}"
    [ -n "$name" ] || usage
    shift
    scenarios=("$@")
    [ ${#scenarios[@]} -gt 0 ] || scenarios=(steady)

    [ -n "$(setting DATABASE_URL)" ] || start_throwaway_db
    if [ -z "$(setting SESSION_SECRET)" ]; then
      export SESSION_SECRET="ux-verify-placeholder-secret-at-least-32-characters"
    fi

    rm -rf ux-report
    bash scripts/ux/run-harness.sh "${scenarios[@]}"

    mkdir -p ux-verify
    rm -rf "ux-verify/${name}"
    mv ux-report "ux-verify/${name}"
    echo ""
    echo "snapshot '${name}' → ux-verify/${name}/ (${scenarios[*]})"
    ;;

  diff)
    before="${1:-}"
    after="${2:-}"
    [ -n "$before" ] && [ -n "$after" ] || usage
    node scripts/ux/axe-diff.mjs "ux-verify/${before}" "ux-verify/${after}"
    ;;

  *)
    usage
    ;;
esac
