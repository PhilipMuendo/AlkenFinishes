import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

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

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
