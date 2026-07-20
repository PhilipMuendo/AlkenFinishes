/**
 * Bootstrap seed: creates the initial SUPERADMIN and default settings.
 * Idempotent — safe to run on every deploy.
 *
 * Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in the environment;
 * defaults are for local development only.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@alkenfinishes.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';

  if (process.env.NODE_ENV === 'production' && (!process.env.SEED_ADMIN_PASSWORD || password === 'ChangeMe!123')) {
    throw new Error('Refusing to seed production with a default admin password. Set SEED_ADMIN_PASSWORD.');
  }

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'System Administrator',
      role: 'SUPERADMIN',
    },
  });

  await prisma.setting.upsert({
    where: { key: 'budgetThresholds' },
    update: {},
    create: { key: 'budgetThresholds', value: { yellowPct: 80, redPct: 100 } },
  });

  console.log(`Seeded superadmin ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
