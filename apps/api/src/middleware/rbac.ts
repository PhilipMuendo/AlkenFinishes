import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/http';

export function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'SUPERADMIN') return next(ApiError.forbidden());
  next();
}

/**
 * Site scoping: SUPERADMIN sees everything; SUPERVISOR only projects
 * where they are the assigned supervisor. Reads projectId from
 * req.params.projectId (or req.body.projectId as a fallback).
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction) {
  const projectId = (req.params.projectId ?? req.body?.projectId) as string | undefined;
  if (!projectId) return next(ApiError.badRequest('projectId is required'));
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, supervisorId: true },
  });
  if (!project) return next(ApiError.notFound('Project not found'));
  if (req.user!.role !== 'SUPERADMIN' && project.supervisorId !== req.user!.id) {
    return next(ApiError.forbidden('You are not assigned to this site'));
  }
  next();
}

/** Prisma `where` filter limiting projects to those visible to the user. */
export function projectScope(user: { id: string; role: string }) {
  return user.role === 'SUPERADMIN' ? {} : { supervisorId: user.id };
}
