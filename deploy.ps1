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
    docker compose up -d
} else {
    Write-Host "==> Building changed layers and starting..." -ForegroundColor Cyan
    docker compose up -d --build
}

Write-Host "==> Removing old images..." -ForegroundColor Cyan
docker image prune -f | Out-Null

Write-Host ""
Write-Host "Done. App is running at http://localhost" -ForegroundColor Green
Write-Host "  Logs:  docker compose logs -f" -ForegroundColor DarkGray
Write-Host "  Stop:  docker compose down" -ForegroundColor DarkGray
docker compose ps
