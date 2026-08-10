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

Back up before a deploy that changes the schema:

```bash
docker compose exec db pg_dump -U alken alkenfinishes > backup-$(date +%F).sql
```

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
