import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(ApiError.unauthorized());
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
    req.user = {
      id: payload.sub as string,
      role: payload.role as Role,
      email: payload.email as string,
      name: payload.name as string,
    };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}
