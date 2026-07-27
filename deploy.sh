#!/usr/bin/env bash
# Alken Decor — one-command local deploy (Linux / macOS)
# Usage:  ./deploy.sh          rebuild changed layers and (re)start in background
#         ./deploy.sh --fresh  full rebuild with no cache (rarely needed)
set -euo pipefail

echo "==> Pulling latest changes..."
git pull

if [[ "${1:-}" == "--fresh" ]]; then
  echo "==> Full rebuild (no cache)..."
  docker compose build --no-cache
else
  echo "==> Building changed layers..."
  docker compose build
fi

# --force-recreate matters: compose sometimes decides a service "hasn't
# changed" and leaves the OLD container running even after a fresh image was
# built, silently serving stale code. Force it every time so a deploy always
# actually deploys.
echo "==> Starting (force-recreate)..."
docker compose up -d --force-recreate

echo "==> Removing old images..."
docker image prune -f >/dev/null

echo ""
echo "Done. App is running at http://localhost"
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
docker compose ps
