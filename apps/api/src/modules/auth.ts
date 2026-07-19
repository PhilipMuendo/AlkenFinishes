import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ApiError, asyncHandler } from '../utils/http';
import { requireAuth, signAccessToken } from '../middleware/auth';
import { audit } from '../middleware/audit';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueRefreshToken(userId: string) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86400_000);
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  return token;
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid credentials');
    }
    const authUser = { id: user.id, role: user.role, email: user.email, name: user.name };
    const accessToken = signAccessToken(authUser);
    const refreshToken = await issueRefreshToken(user.id);
    audit(req, 'auth.login', 'User', user.id);
    res.json({ accessToken, refreshToken, user: authUser });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    // Rotation: revoke old, issue new.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const u = stored.user;
    const authUser = { id: u.id, role: u.role, email: u.email, name: u.name };
    res.json({
      accessToken: signAccessToken(authUser),
      refreshToken: await issueRefreshToken(u.id),
      user: authUser,
    });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), userId: req.user!.id },
        data: { revokedAt: new Date() },
      });
    }
    audit(req, 'auth.logout', 'User', req.user!.id);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, name: true, phone: true, role: true },
    });
    if (!user) throw ApiError.unauthorized();
    res.json(user);
  }),
);

export default router;
