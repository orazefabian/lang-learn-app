#!/bin/sh
# Postgres restore.
#
# The counterpart to backup.sh, written down because the moment you need it is
# the worst moment to be improvising.
#
#   DATABASE_URL=postgres://... scripts/ops/restore.sh /backups/slovenscina-....dump
#
# This DROPS AND RECREATES the schema in the target database. It refuses to run
# without CONFIRM_RESTORE=yes, because the one thing worse than losing data is
# a restore script that is easy to run at the wrong database.
set -eu

: "${DATABASE_URL:?set DATABASE_URL}"
dump="${1:?usage: restore.sh <dump-file>}"

[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 1; }

if ! pg_restore --list "$dump" > /dev/null 2>&1; then
  echo "not a readable custom-format dump: $dump" >&2
  exit 1
fi

# Never print the password back at whoever is running this.
target="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+):[^@]*@#\1:***@#')"

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  cat >&2 <<EOF
About to restore
  from: $dump
  into: $target

This drops and recreates every table in that database.
Re-run with CONFIRM_RESTORE=yes to proceed.
EOF
  exit 1
fi

echo "restoring $dump into $target"

# --clean --if-exists so restoring over a live schema works; the app is stopped
# for this, and Drizzle's migration table comes back with the rest.
pg_restore --clean --if-exists --no-owner --no-privileges \
           --dbname="$DATABASE_URL" "$dump"

echo "restore complete"
echo
echo "Next:"
echo "  1. start the app — it runs any migrations newer than the dump on boot"
echo "  2. check /api/ready reports the database up"
echo "  3. restore the media volume separately if you are rebuilding a host"
