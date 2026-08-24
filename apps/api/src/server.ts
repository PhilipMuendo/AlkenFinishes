import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { syncAllSupremaDevices } from './services/biostar';
import { runNotificationScan } from './services/notifications';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`AlkenFinishes API listening on :${env.PORT}`);
});

// Housekeeping: prune dead refresh tokens so the table doesn't grow forever.
async function pruneRefreshTokens() {
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  await prisma.refreshToken
    .deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    })
    .catch((e) => logger.error(e, 'refresh token prune failed'));
}
void pruneRefreshTokens();
const pruneTimer = setInterval(() => void pruneRefreshTokens(), 24 * 3600_000);
pruneTimer.unref();

// Suprema/BioStar 2 terminals are polled, not pushed to — see services/biostar.ts.
// Every 2 minutes keeps attendance close to real-time without hammering a
// LAN appliance; a manual "Sync now" (POST /devices/:id/sync) covers anyone
// who doesn't want to wait.
const biostarTimer = setInterval(() => void syncAllSupremaDevices(), 2 * 60_000);
biostarTimer.unref();

// Budget/payment/contract notifications aren't triggered by a single write —
// they're a rolling condition — so they're re-derived from current state on
// a timer instead (services/notifications.ts). 10 minutes is frequent enough
// that a newly-overdue invoice shows up the same morning without scanning
// the whole portfolio needlessly often.
void runNotificationScan().catch((e) => logger.error(e, 'initial notification scan failed'));
const notificationTimer = setInterval(
  () => void runNotificationScan().catch((e) => logger.error(e, 'notification scan failed')),
  10 * 60_000,
);
notificationTimer.unref();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
