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
  return hasFinanceAccess(user.role) ? {} : { supervisorId: user.id };
}

const FINANCE_ROLES = new Set(['SUPERADMIN', 'ACCOUNTANT']);

/** True for anyone with full company finance/tax/payroll access. */
export function hasFinanceAccess(role: string): boolean {
  return FINANCE_ROLES.has(role);
}

/** Router-level gate for finance/tax/payroll endpoints. */
export function requireFinanceRole(req: Request, _res: Response, next: NextFunction) {
  if (!hasFinanceAccess(req.user?.role ?? '')) return next(ApiError.forbidden());
  next();
}

/**
 * Project-scoped gate for routers that mix site-membership checks with money
 * data. SUPERADMIN and ACCOUNTANT see every project; SUPERVISOR must still be
 * the assigned supervisor. Not a replacement for requireProjectAccess — most
 * project routers are site-operations and must not admit ACCOUNTANT.
 */
export async function requireFinanceProjectAccess(req: Request, _res: Response, next: NextFunction) {
  const projectId = (req.params.projectId ?? req.body?.projectId) as string | undefined;
  if (!projectId) return next(ApiError.badRequest('projectId is required'));
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, supervisorId: true },
  });
  if (!project) return next(ApiError.notFound('Project not found'));
  if (!hasFinanceAccess(req.user!.role) && project.supervisorId !== req.user!.id) {
    return next(ApiError.forbidden('You are not assigned to this site'));
  }
  next();
}
