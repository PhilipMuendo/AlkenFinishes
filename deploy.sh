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
  docker compose up -d
else
  echo "==> Building changed layers and starting..."
  docker compose up -d --build
fi

echo "==> Removing old images..."
docker image prune -f >/dev/null

echo ""
echo "Done. App is running at http://localhost"
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
docker compose ps
