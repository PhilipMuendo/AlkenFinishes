#!/usr/bin/env bash
# Alken Decor — backup (Linux / macOS)
#
# Writes two files per run into the backup directory:
#   alken-db-<stamp>.sql.gz         full Postgres dump
#   alken-uploads-<stamp>.tar.gz    site photos, signed contracts, handover PDFs
#
# Usage:   ./backup.sh [backup-dir]          (default ./backups)
# Env:     RETENTION_DAYS=14                 (older alken-* files are deleted)
#
# Cron (daily 02:00):
#   0 2 * * * cd /path/to/AlkenFinishes && ./backup.sh >> backups/backup.log 2>&1
#
# A backup that lives only on the machine it protects is not a backup against
# losing that machine. Copy the directory off the host (rclone, rsync, scp).
set -euo pipefail
cd "$(dirname "$0")"

DEST="${1:-./backups}"
KEEP="${RETENTION_DAYS:-14}"
STAMP="$(date +%F_%H%M%S)"
mkdir -p "$DEST"

DB_FILE="$DEST/alken-db-$STAMP.sql.gz"
UP_FILE="$DEST/alken-uploads-$STAMP.tar.gz"

# Written to .tmp and renamed only once verified, so a crash or full disk never
# leaves a truncated file that looks like a good backup.
cleanup() { rm -f "$DB_FILE.tmp" "$UP_FILE.tmp"; }
trap cleanup EXIT

echo "==> Dumping database..."
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip' > "$DB_FILE.tmp"
gzip -t "$DB_FILE.tmp"
mv "$DB_FILE.tmp" "$DB_FILE"

echo "==> Archiving uploads..."
docker compose exec -T api tar -czf - -C /data uploads > "$UP_FILE.tmp"
gzip -t "$UP_FILE.tmp"
mv "$UP_FILE.tmp" "$UP_FILE"

echo "==> Pruning backups older than $KEEP days..."
find "$DEST" -maxdepth 1 -name 'alken-*' -type f -mtime "+$KEEP" -print -delete

echo "Done."
ls -lh "$DB_FILE" "$UP_FILE"
