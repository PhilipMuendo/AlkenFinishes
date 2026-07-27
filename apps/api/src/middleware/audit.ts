import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Fire-and-forget audit trail write; never blocks the request path.
 *
 * `actorId` is only needed on routes that identify a user without going
 * through `requireAuth` (login, token refresh) — there `req.user` is never
 * set, so the default `req.user?.id` would silently record the event with
 * no attributed user at all.
 */
export function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Record<string, unknown>,
  actorId?: string,
) {
  prisma.auditLog
    .create({
      data: {
        userId: actorId ?? req.user?.id,
        action,
        entity,
        entityId,
        meta: meta as object | undefined,
        ip: req.ip,
      },
    })
    .catch((e) => logger.error(e, 'audit write failed'));
}
