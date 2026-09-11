/**
 * Alken's own standing quality checklists — a maintained reference, the same
 * "human-reviewed constant" convention as kenyaTaxReference.ts. Quality must
 * be checked continuously, not only at the end, so this is filled in per
 * area (a room, a wall, a run of trim) as work reaches each stage, not once
 * per project.
 *
 * A named checklist is a fixed, ordered list of labels — nothing here reads
 * or writes a database. Adding a specialised checklist for a specific trade
 * ("for specialized works, use the relevant Alken quality checklist") is a
 * new entry in this map, not a schema change.
 */
export const QUALITY_CHECKLISTS: Record<string, string[]> = {
  'General finishing checklist': [
    'Surface preparation',
    'Priming',
    'Filling/skimming',
    'Sanding',
    'First coat',
    'Second coat',
    'Finishing',
    'Edges/corners',
    'Lines and joints',
    'Colour consistency',
    'Cleanliness',
    'Protection of completed work',
  ],
};

export const DEFAULT_CHECKLIST_NAME = 'General finishing checklist';

export type QualityItemStatus = 'PENDING' | 'PASS' | 'FAIL';

export interface QualityChecklistItem {
  label: string;
  status: QualityItemStatus;
}

export function blankChecklist(name: string): QualityChecklistItem[] {
  const labels = QUALITY_CHECKLISTS[name] ?? QUALITY_CHECKLISTS[DEFAULT_CHECKLIST_NAME];
  return labels.map((label) => ({ label, status: 'PENDING' as const }));
}

/** FAIL beats PASS beats PENDING — one failed point means the area isn't ready, whatever else passed. */
export function overallStatus(items: QualityChecklistItem[]): QualityItemStatus {
  if (items.some((i) => i.status === 'FAIL')) return 'FAIL';
  if (items.length > 0 && items.every((i) => i.status === 'PASS')) return 'PASS';
  return 'PENDING';
}
