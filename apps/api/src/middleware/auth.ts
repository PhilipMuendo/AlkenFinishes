import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] },
  );
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(ApiError.unauthorized());
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
  // Live check: deactivation and role changes take effect immediately,
  // not at token expiry. PK lookup — negligible cost at this scale.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub as string },
    select: { id: true, role: true, email: true, name: true, active: true },
  });
  if (!user || !user.active) return next(ApiError.unauthorized('Account is disabled'));
  req.user = { id: user.id, role: user.role as Role, email: user.email, name: user.name };
  next();
}
