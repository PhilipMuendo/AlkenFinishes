import { prisma } from '../lib/prisma';
import { getCompanyProfile } from './invoicing';
import { renderHandoverPdf, type CapturedSignature, type HandoverChecklistItem } from './documents/handoverPdf';

export type { HandoverChecklistItem };

/**
 * Handover: the office's own final walkthrough before a project is
 * considered finished. Six of its nine checklist items are ticked by a
 * supervisor by hand; the other three are never stored at all — they are
 * computed fresh from the tables that already govern them every time this
 * is loaded, so they can never drift out of sync with the record they're
 * supposed to reflect.
 */
export const MANUAL_HANDOVER_ITEMS = [
  'Site cleaned',
  'Equipment removed',
  'Waste removed',
  'Client inspection completed',
  'Completion confirmation obtained',
  'Keys/access items returned where applicable',
] as const;

// The single source of truth for which labels are computed rather than
// ticked by hand — modules/handover.ts tags each item with this when
// serialising a response, so the frontend never has to guess by matching
// label text (a duplicated, driftable copy of exactly this list).
export const AUTO_HANDOVER_ITEMS = [
  'Final quality inspection completed',
  'Snags closed',
  'Handover photographs taken',
] as const;

/** Find-or-create the one HandoverChecklist row for a project. */
export async function ensureHandoverChecklist(projectId: string, userId: string) {
  const existing = await prisma.handoverChecklist.findUnique({ where: { projectId } });
  if (existing) return existing;
  return prisma.handoverChecklist.create({
    data: {
      projectId,
      items: MANUAL_HANDOVER_ITEMS.map((label) => ({ label, checked: false })),
      createdById: userId,
    },
  });
}

async function autoItems(projectId: string): Promise<HandoverChecklistItem[]> {
  const [inspectionCounts, openSnags] = await Promise.all([
    prisma.qualityInspection.groupBy({
      by: ['overallStatus'],
      where: { projectId },
      _count: true,
    }),
    prisma.snagItem.count({
      where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] } },
    }),
  ]);
  const total = inspectionCounts.reduce((s, r) => s + r._count, 0);
  const notPassed = inspectionCounts
    .filter((r) => r.overallStatus !== 'PASS')
    .reduce((s, r) => s + r._count, 0);

  return [
    { label: AUTO_HANDOVER_ITEMS[0], checked: total > 0 && notPassed === 0 },
    { label: AUTO_HANDOVER_ITEMS[1], checked: openSnags === 0 },
  ];
}

/** The full nine-item checklist — auto items first, then the manual six, in the client's own order. */
export async function mergedItems(
  projectId: string,
  manual: HandoverChecklistItem[],
  photoCount: number,
): Promise<HandoverChecklistItem[]> {
  const [quality, snags] = await autoItems(projectId);
  return [
    quality,
    snags,
    ...manual,
    { label: AUTO_HANDOVER_ITEMS[2], checked: photoCount > 0 },
  ];
}

/**
 * Renders the certificate for a handover. `overrides` lets a caller pass a
 * signature that hasn't been written to the database yet — the whole point
 * being that both the client-sign and countersign routes must render BEFORE
 * persisting anything, so a rendering failure (a bad signature image, disk
 * full, a pdfmake error) never leaves a "signed" record with no valid PDF, a
 * burned single-use signing link, and no way to retry. Without an override,
 * a side's signature is read from the row as already persisted — which is
 * exactly right for the side that signed earlier (e.g. the client's, when
 * countersigning) and never for the side about to be persisted right now.
 */
export async function renderHandover(
  handoverId: string,
  overrides?: { clientSignature?: CapturedSignature; companySignature?: CapturedSignature },
): Promise<string> {
  const h = await prisma.handoverChecklist.findUniqueOrThrow({
    where: { id: handoverId },
    include: { project: { select: { name: true, clientName: true } } },
  });

  const items = await mergedItems(h.projectId, h.items as unknown as HandoverChecklistItem[], h.photoUrls.length);
  const company = await getCompanyProfile();

  const clientSignature: CapturedSignature | undefined =
    overrides?.clientSignature ??
    (h.clientSignerName
      ? {
          name: h.clientSignerName,
          imageUrl: h.clientSignatureImageUrl,
          signedAt: h.clientSignedAt ?? new Date(),
          ip: h.clientSignatureIp ?? undefined,
        }
      : undefined);
  const companySignature: CapturedSignature | undefined =
    overrides?.companySignature ??
    (h.companySignerName
      ? {
          name: h.companySignerName,
          imageUrl: h.companySignatureImageUrl,
          signedAt: h.companySignedAt ?? new Date(),
        }
      : undefined);

  return renderHandoverPdf(
    {
      projectName: h.project.name,
      clientName: h.project.clientName,
      items,
      notes: h.notes,
    },
    company,
    clientSignature,
    companySignature,
  );
}
