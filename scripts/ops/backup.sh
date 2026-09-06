#!/bin/sh
# Postgres backup.
#
# Runs anywhere there is pg_dump and a writable directory: a host crontab, a
# compose sidecar, or the Kubernetes CronJob in k8s/. Deliberately a shell
# script and not a service — a backup you cannot read and run by hand at 2am is
# not a backup.
#
#   DATABASE_URL=postgres://... BACKUP_DIR=/backups scripts/ops/backup.sh
#
# Environment:
#   DATABASE_URL     required, the database to dump
#   BACKUP_DIR       where dumps go (default /backups)
#   RETENTION_DAYS   delete dumps older than this (default 30, 0 keeps forever)
#   BACKUP_LABEL     optional suffix, e.g. "pre-upgrade"
set -eu

: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
label="${BACKUP_LABEL:+-$BACKUP_LABEL}"
target="$BACKUP_DIR/slovenscina-$timestamp$label.dump"

mkdir -p "$BACKUP_DIR"

# Custom format: compressed, and pg_restore can do a partial or parallel
# restore from it. Plain SQL would need re-dumping to get either.
#
# Written to a .partial and moved into place only on success, so a crash or a
# full disk can never leave a truncated file that looks like a good backup.
echo "dumping to $target"
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --file="$target.partial" "$DATABASE_URL"
mv "$target.partial" "$target"

size="$(du -h "$target" | cut -f1)"
echo "wrote $target ($size)"

# Verify it is readable before trusting it. A dump that pg_restore cannot list
# is worse than no dump, because it will be believed.
if ! pg_restore --list "$target" > /dev/null 2>&1; then
  echo "FAILED: $target is not a readable dump" >&2
  exit 1
fi
echo "verified: pg_restore can read it"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  # Only ever deletes files this script's own naming produced.
  removed="$(find "$BACKUP_DIR" -maxdepth 1 -name 'slovenscina-*.dump' \
             -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
  echo "retention: removed $removed dump(s) older than $RETENTION_DAYS days"
fi

# Leftover partials from an earlier crash, cleaned up once they are clearly dead.
find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.partial' -type f -mtime +1 -delete 2>/dev/null || true

echo "backup complete"
