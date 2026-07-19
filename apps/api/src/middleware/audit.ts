import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/** Fire-and-forget audit trail write; never blocks the request path. */
export function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Record<string, unknown>,
) {
  prisma.auditLog
    .create({
      data: {
        userId: req.user?.id,
        action,
        entity,
        entityId,
        meta: meta as object | undefined,
        ip: req.ip,
      },
    })
    .catch((e) => logger.error(e, 'audit write failed'));
}
