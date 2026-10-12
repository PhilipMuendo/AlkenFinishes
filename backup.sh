#!/usr/bin/env bash
# Alken Decor — backup (Linux / macOS)
#
# Writes two files per run into the backup directory:
#   alken-db-<stamp>.sql.gz         full Postgres dump
#   alken-uploads-<stamp>.tar.gz    site photos, signed contracts, handover PDFs
#
# Optionally copies both, ENCRYPTED, to a remote (Google Drive, S3, Backblaze,
# another server — anything rclone supports). See "Off-site copy" in DEPLOY.md.
#
# Usage:   ./backup.sh [backup-dir]          (default ./backups)
#
# Settings (environment, or the same names in .env):
#   RETENTION_DAYS=14        local files older than this are deleted
#   RCLONE_REMOTE=           e.g. gdrive:AlkenBackups  — empty = no off-site copy
#   BACKUP_PASSPHRASE=       required when RCLONE_REMOTE is set; files are
#                            AES-256 encrypted with it BEFORE they leave here
#   REMOTE_RETENTION_DAYS=30 remote alken-*.gpg files older than this are deleted
#
# Cron (daily 02:00):
#   0 2 * * * cd /path/to/AlkenFinishes && ./backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
# Git Bash on Windows rewrites arguments that look like POSIX paths (/data ->
# C:/Program Files/Git/data) before docker sees them. No-op everywhere else.
export MSYS_NO_PATHCONV=1

# A setting from the environment, else from .env (read, never sourced — a .env
# can contain characters the shell would interpret).
cfg() {
  local name="$1" default="${2:-}" val="${!1:-}"
  if [ -z "$val" ] && [ -f .env ]; then
    val="$(grep -E "^${name}=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")" || true
  fi
  printf '%s' "${val:-$default}"
}

DEST="${1:-./backups}"
KEEP="$(cfg RETENTION_DAYS 14)"
REMOTE="$(cfg RCLONE_REMOTE)"
REMOTE_KEEP="$(cfg REMOTE_RETENTION_DAYS 30)"
PASS="$(cfg BACKUP_PASSPHRASE)"
STAMP="$(date +%F_%H%M%S)"

# Fail before touching anything if off-site is half-configured. An unencrypted
# copy of client and financial data in a cloud drive is worse than no copy.
if [ -n "$REMOTE" ]; then
  [ -n "$PASS" ] || { echo "RCLONE_REMOTE is set but BACKUP_PASSPHRASE is not — refusing to upload unencrypted." >&2; exit 1; }
  command -v rclone >/dev/null || { echo "rclone is not installed (https://rclone.org/install/)." >&2; exit 1; }
  command -v gpg >/dev/null || { echo "gpg is not installed (apt install gnupg)." >&2; exit 1; }
  # Also proves the remote is reachable and authorised before a long dump.
  rclone mkdir "$REMOTE"
fi

mkdir -p "$DEST"
DB_FILE="$DEST/alken-db-$STAMP.sql.gz"
UP_FILE="$DEST/alken-uploads-$STAMP.tar.gz"

# Written to .tmp and renamed only once verified, so a crash or full disk never
# leaves a truncated file that looks like a good backup.
cleanup() { rm -f "$DB_FILE.tmp" "$UP_FILE.tmp" "$DB_FILE.gpg" "$UP_FILE.gpg" "$DB_FILE.gpg.tmp" "$UP_FILE.gpg.tmp"; }
trap cleanup EXIT

echo "==> Dumping database..."
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip' > "$DB_FILE.tmp"
gzip -t "$DB_FILE.tmp"
mv "$DB_FILE.tmp" "$DB_FILE"

echo "==> Archiving uploads..."
docker compose exec -T api tar -czf - -C /data uploads > "$UP_FILE.tmp"
gzip -t "$UP_FILE.tmp"
mv "$UP_FILE.tmp" "$UP_FILE"

echo "==> Pruning local backups older than $KEEP days..."
find "$DEST" -maxdepth 1 -name 'alken-*' -type f -mtime "+$KEEP" -print -delete

if [ -n "$REMOTE" ]; then
  echo "==> Encrypting and uploading to $REMOTE ..."
  for f in "$DB_FILE" "$UP_FILE"; do
    # Passphrase goes in on fd 3 so it never appears in the process list.
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
      --symmetric --cipher-algo AES256 -o "$f.gpg.tmp" "$f" 3<<<"$PASS"
    # Prove the passphrase decrypts it and the gzip inside is intact, before
    # trusting it as the off-site copy.
    gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$f.gpg.tmp" 3<<<"$PASS" | gzip -t
    mv "$f.gpg.tmp" "$f.gpg"
    rclone copyto "$f.gpg" "$REMOTE/$(basename "$f").gpg"
    rm -f "$f.gpg"
  done

  echo "==> Pruning remote copies older than $REMOTE_KEEP days..."
  # Restricted to our own filenames so nothing else in that folder is touched.
  rclone delete "$REMOTE" --include 'alken-*.gpg' --min-age "${REMOTE_KEEP}d" -v 2>&1 | grep -E "Deleted" || true
fi

echo "Done."
ls -lh "$DB_FILE" "$UP_FILE"
[ -n "$REMOTE" ] && echo "Off-site: $REMOTE (encrypted)"
exit 0
