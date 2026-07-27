# Alken Decor — one-command local deploy (Windows PowerShell)
# Usage:  .\deploy.ps1
# Pulls the latest code, rebuilds only what changed, and (re)starts the app
# in the background. Reserve a full rebuild for the rare stale-image case:
#   .\deploy.ps1 -Fresh

param([switch]$Fresh)

$ErrorActionPreference = "Stop"

Write-Host "==> Pulling latest changes..." -ForegroundColor Cyan
git pull

if ($Fresh) {
    Write-Host "==> Full rebuild (no cache)..." -ForegroundColor Cyan
    docker compose build --no-cache
} else {
    Write-Host "==> Building changed layers..." -ForegroundColor Cyan
    docker compose build
}

# --force-recreate matters: compose sometimes decides a service "hasn't
# changed" and leaves the OLD container running even after a fresh image was
# built, silently serving stale code. Force it every time so a deploy always
# actually deploys.
Write-Host "==> Starting (force-recreate)..." -ForegroundColor Cyan
docker compose up -d --force-recreate

Write-Host "==> Removing old images..." -ForegroundColor Cyan
docker image prune -f | Out-Null

Write-Host ""
Write-Host "Done. App is running at http://localhost" -ForegroundColor Green
Write-Host "  Logs:  docker compose logs -f" -ForegroundColor DarkGray
Write-Host "  Stop:  docker compose down" -ForegroundColor DarkGray
docker compose ps
