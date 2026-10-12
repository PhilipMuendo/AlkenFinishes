# Alken Decor - backup (Windows)
#
# Writes two files per run into the backup directory:
#   alken-db-<stamp>.sql.gz         full Postgres dump
#   alken-uploads-<stamp>.tar.gz    site photos, signed contracts, handover PDFs
#
# Usage:  .\backup.ps1 [-Dest .\backups] [-RetentionDays 14]
#
# A backup that lives only on the machine it protects is not a backup against
# losing that machine. Copy the directory somewhere else as well.
param(
  [string]$Dest = ".\backups",
  [int]$RetentionDays = 14
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Dest = (Resolve-Path $Dest).Path
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$dbFile = Join-Path $Dest "alken-db-$stamp.sql.gz"
$upFile = Join-Path $Dest "alken-uploads-$stamp.tar.gz"

# Redirection goes through cmd.exe on purpose: PowerShell 5.1 pipes and `>`
# re-encode output as text and would corrupt a gzip stream.
function Invoke-Capture([string]$command, [string]$outFile) {
  $tmp = "$outFile.tmp"
  cmd /c "$command > `"$tmp`""
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    throw "Backup step failed: $command"
  }
  Move-Item $tmp $outFile
}

Write-Host "==> Dumping database..."
Invoke-Capture "docker compose exec -T db sh -c `"pg_dump -U `$POSTGRES_USER --no-owner `$POSTGRES_DB | gzip`"" $dbFile

Write-Host "==> Archiving uploads..."
Invoke-Capture "docker compose exec -T api tar -czf - -C /data uploads" $upFile

Write-Host "==> Pruning backups older than $RetentionDays days..."
Get-ChildItem $Dest -Filter "alken-*" -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  ForEach-Object { Write-Host "  removing $($_.Name)"; Remove-Item $_.FullName }

Write-Host "Done."
Get-Item $dbFile, $upFile | Select-Object Name, @{n = "MB"; e = { [math]::Round($_.Length / 1MB, 2) } }
