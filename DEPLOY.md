# Deploying Alken Decor

## Local deploy — one command

Instead of running `git pull`, `docker compose build`, and `docker compose up`
separately, use the deploy script.

**Windows (PowerShell):**
```powershell
.\deploy.ps1
```

**Linux / macOS:**
```bash
./deploy.sh
```

**Or with npm (any OS):**
```bash
npm run deploy
```

All of these do the same thing: pull the latest code, rebuild only the layers
that changed, (re)start the app in the background, and clean up old images. The
app stays at **http://localhost**.

Useful follow-ups:
```bash
npm run logs      # watch the container logs
npm run stop      # stop the app
npm run restart   # restart without rebuilding
```

### When a rebuild misbehaves

Routine deploys use Docker's build cache and are light. Only if you suspect a
stale image do you need a full, no-cache rebuild:

```powershell
.\deploy.ps1 -Fresh      # Windows
./deploy.sh --fresh      # Linux/macOS
npm run deploy:fresh     # any OS
```

**If you see `failed to solve: Unavailable: error reading from server: EOF`:**
that's Docker Desktop's builder running out of memory — usually caused by a full
`--no-cache` rebuild. To fix it:

1. Just retry — it's often transient.
2. Prefer the normal deploy (cached), not `--fresh` / `--no-cache`.
3. Give Docker Desktop more memory: **Settings → Resources → Memory = 4–8 GB**,
   and make sure the disk isn't full.
4. If it persists: `docker builder prune -f`, restart Docker Desktop, retry.

**If the site still looks old after a successful deploy — even in incognito:**
that means Docker itself served the old code, not your browser. Check
`docker compose ps`: if a container's `CREATED` time is much older than when
you just deployed, Compose decided that service "hadn't changed" and left the
stale container running on a stale image. Both deploy scripts now pass
`--force-recreate` to prevent this, but if you ever run `docker compose up`
manually, use:
```bash
docker compose up -d --build --force-recreate
```

### Seeing UI changes after a deploy

The app is a PWA and the browser caches it. After a deploy it self-updates
within a load or two; to force it immediately, hard-refresh (**Ctrl+Shift+R**)
or open the site in a private window.

### Changing configuration

Everything is configured through `.env` (see `.env.example`). It is gitignored
— keep the real values off the repo and out of chat logs.

Changing a variable needs the container recreated, not just restarted:

```bash
docker compose up -d api      # picks up the new environment
```

`npm run restart` will **not** pick up `.env` changes.

Two worth knowing about:

- **`APP_TIMEZONE`** sets both the container clock and the zone the code
  reasons in. Leave it at `Africa/Nairobi` unless the business moves. Getting
  it wrong files late-evening work against the wrong day.
- **`GEMINI_API_KEY`** switches on the three AI features. Without it they are
  absent and every form works by hand. It is an AI Studio key beginning
  `AIza`; an OAuth token (`AQ.…`) is a different credential and will not work.

### Database migrations

The `api` container runs `prisma migrate deploy` on every boot, so a deploy
that includes a new migration applies it automatically. Nothing to do by hand.

Back up before a deploy that changes the schema — see **Backups** below.

---

## Backups

Two things hold your data: the Postgres database, and the `uploads` volume
(site photos, signed contracts, handover certificates — your legal records).
One script captures both:

```bash
./backup.sh            # Linux/macOS  -> ./backups/
.\backup.ps1           # Windows
```

Each run writes `alken-db-<stamp>.sql.gz` and `alken-uploads-<stamp>.tar.gz`,
checks the archives are readable before keeping them, and deletes anything
older than 14 days (`RETENTION_DAYS=30 ./backup.sh` to change).

**Schedule it** (daily at 02:00):

```bash
0 2 * * * cd /path/to/AlkenFinishes && ./backup.sh >> backups/backup.log 2>&1
```

### Off-site copy (encrypted)

A backup on the same disk as the data does not survive that disk.
`backup.sh` can send each run to Google Drive (or S3, Backblaze B2, another
server — anything [rclone](https://rclone.org) supports). Files are encrypted
with AES-256 **before they leave the server**, so the storage provider only
ever holds scrambled data.

(Off-site upload is a feature of `backup.sh`, which is what runs on the Linux
server. `backup.ps1` is local-only.)

**One-time setup on the server:**

```bash
sudo apt install -y rclone gnupg        # or: curl https://rclone.org/install.sh | sudo bash
rclone config                           # n) new remote -> name: gdrive -> storage: drive
                                        # scope: "drive.file" is enough (only files rclone creates)
                                        # headless server: answer "n" to auto config and follow the
                                        # prompt to authorise from your laptop (rclone authorize "drive")
rclone lsd gdrive:                      # proves it works
```

Then in `.env` on the server:

```
RCLONE_REMOTE=gdrive:AlkenBackups
BACKUP_PASSPHRASE=<a long random passphrase>
REMOTE_RETENTION_DAYS=30
```

Use a dedicated, company-owned Google account with 2-step verification, not a
personal one. The next `./backup.sh` (and every cron run after) uploads
`alken-db-<stamp>.sql.gz.gpg` and `alken-uploads-<stamp>.tar.gz.gpg`, checks the
passphrase decrypts them, and deletes remote copies older than
`REMOTE_RETENTION_DAYS`. It only ever touches files named `alken-*.gpg`.

- The script **refuses to upload** if `BACKUP_PASSPHRASE` is empty.
- **Keep the passphrase somewhere other than the server** (a password manager).
  Without it the off-site backups cannot be opened — by you or anyone else.
- Free Drive space is 15 GB shared by the whole account. Uploads (photos) are
  what grow; raise `REMOTE_RETENTION_DAYS` only as far as the space allows.

**Sending a copy to the client:** download one `.gpg` pair from Drive and send
those. Give them the passphrase through a different channel than the files.
They open them with [Gpg4win](https://www.gpg4win.org) (Windows) or `gpg`:

```bash
gpg --output alken-db.sql.gz --decrypt alken-db-<stamp>.sql.gz.gpg
```

**Restore** (this replaces current data — stop and think first):

```bash
# database
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c backups/alken-db-<stamp>.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'

# uploads
docker compose exec -T api tar -xzf - -C /data < backups/alken-uploads-<stamp>.tar.gz
docker compose restart api
```

Do a trial restore into a scratch environment at least once. A backup you have
never restored is a hope, not a backup.

---

## HTTPS

Without it, passwords and login tokens cross the network in clear text, and
browsers will not install the app or run its offline service worker on a real
domain. Caddy fixes this with no certificate handling by you.

1. Point a DNS `A` record for your domain (e.g. `app.yourcompany.co.ke`) at the
   server. Open ports **80 and 443** in its firewall.
2. In `.env`, set:
   ```
   DOMAIN=app.yourcompany.co.ke
   CORS_ORIGIN=https://app.yourcompany.co.ke
   COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml   # use ; on Windows
   ```
3. `docker compose up -d --build --force-recreate`

Caddy requests the certificate on first start and renews it automatically.
Keep the `caddy_data` volume — it holds the certificates, and Let's Encrypt
rate-limits re-issuing. The overlay also sets `TRUST_PROXY_HOPS=2` so the API
sees each visitor's real IP behind the two proxies; if you add another proxy
or CDN in front, raise that number by one.

---

## Going further — push to deploy (no local Docker at all)

The script above still runs on your laptop. To stop touching Docker entirely,
run the app on an always-on server that redeploys itself whenever you push to
GitHub. Two good paths:

### Option A — Cheap server + auto-deploy on push (keeps this exact setup)

Best if you want to keep the current `docker-compose.yml` unchanged.

1. Rent a small Linux server (e.g. Hetzner ~€4/mo, DigitalOcean $6/mo, or a
   local provider). Install Docker + the Compose plugin.
2. Clone this repo on the server and create its `.env` (as in `.env.example`).
3. Add a GitHub Actions workflow so every push redeploys over SSH. Save the
   server's host, user, and an SSH key as repo secrets (`DEPLOY_HOST`,
   `DEPLOY_USER`, `DEPLOY_KEY`), then add `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy
   on:
     push:
       branches: [main]        # or your deployment branch
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - name: Deploy over SSH
           uses: appleboy/ssh-action@v1
           with:
             host: ${{ secrets.DEPLOY_HOST }}
             username: ${{ secrets.DEPLOY_USER }}
             key: ${{ secrets.DEPLOY_KEY }}
             script: |
               cd /path/to/AlkenFinishes
               git pull
               docker compose up -d --build
               docker image prune -f
   ```

   Now: **push → the site updates itself in ~2 minutes.** No local Docker.

### Option B — Managed platform (least server admin)

Platforms like **Render** or **Railway** connect directly to the GitHub repo,
build the Docker images for you, host a managed PostgreSQL, and auto-deploy on
every push. Slightly higher cost, but nothing to maintain. The API and web
Dockerfiles here work as-is; you'd point the platform at each and attach its
managed database via `DATABASE_URL`.

Either option gives you a real URL and push-to-deploy. When you're ready, pick
one and I'll wire up the workflow (Option A) or the service config (Option B).
