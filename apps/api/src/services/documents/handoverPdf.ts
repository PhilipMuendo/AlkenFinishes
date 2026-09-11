import fs from 'fs';
import path from 'path';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { env } from '../../config/env';
import { MUTED, letterhead, lineTableLayout, printDate, renderPdfToUpload } from '../pdf';
import type { CompanyProfile } from '../invoicing';

/**
 * The Handover Certificate — a bespoke template, not the generic
 * renderReportPdf, because (unlike a Weekly Progress or Close-out report)
 * this one carries a signature block. Follows contractPdf.ts's structure:
 * a checklist table, then either party's block once they've signed
 * electronically, or a blank ruled block if they haven't yet.
 */

export interface CapturedSignature {
  name: string;
  imageUrl?: string | null;
  signedAt: Date;
  ip?: string;
}

export interface HandoverChecklistItem {
  label: string;
  checked: boolean;
}

export interface HandoverForPdf {
  projectName: string;
  clientName: string;
  items: HandoverChecklistItem[]; // all nine, auto + manual, already merged
  notes: string | null;
}

export async function renderHandoverPdf(
  h: HandoverForPdf,
  company: CompanyProfile,
  clientSignature?: CapturedSignature,
  companySignature?: CapturedSignature,
): Promise<string> {
  const content: Content[] = [
    {
      stack: [
        { text: 'Handover Certificate', style: 'docTitle' },
        { text: h.projectName, style: 'companyMeta', margin: [0, 6, 0, 0] },
      ],
      margin: [0, 0, 0, 18],
    },
    {
      table: {
        headerRows: 1,
        widths: ['*', 80],
        body: [
          [
            { text: 'Item', style: 'tableHeader' },
            { text: 'Status', style: 'tableHeader', alignment: 'right' },
          ],
          ...h.items.map((i): [Content, Content] => [
            { text: i.label },
            { text: i.checked ? 'Complete' : 'Outstanding', alignment: 'right', color: i.checked ? undefined : MUTED },
          ]),
        ],
      },
      layout: lineTableLayout,
    },
  ];

  if (h.notes) {
    content.push({ text: 'Notes', style: 'sectionLabel', margin: [0, 16, 0, 4] });
    content.push({ text: h.notes, fontSize: 9, margin: [0, 0, 0, 0] });
  }

  content.push({
    columns: [
      { width: '*', stack: partyBlock('Client', h.clientName, clientSignature) },
      { width: '*', stack: partyBlock('For and on behalf of the Contractor', company.name, companySignature) },
    ],
    columnGap: 24,
    margin: [0, 24, 0, 0],
  });

  const def: TDocumentDefinitions = {
    info: { title: 'Handover Certificate', author: company.name, subject: h.projectName },
    ...letterhead(company),
    content,
  };

  return renderPdfToUpload(def, 'handover-certificate');
}

function partyBlock(role: string, party: string, sig?: CapturedSignature): Content[] {
  if (!sig) {
    return [
      { text: role, fontSize: 7.5, color: MUTED, margin: [0, 6, 0, 0] },
      { text: party, bold: true, margin: [0, 1, 0, 0] },
      { margin: [0, 20, 0, 0], canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: MUTED }] },
      { text: 'Signature', fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
      { margin: [0, 20, 0, 0], canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: MUTED }] },
      { text: 'Date', fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
    ];
  }
  const imageContent = signatureImageContent(sig.imageUrl);
  return [
    { text: role, fontSize: 7.5, color: MUTED, margin: [0, 6, 0, 0] },
    { text: party, bold: true, margin: [0, 1, 0, 0] },
    { margin: [0, 20, 0, 0], text: 'Name', fontSize: 7, color: MUTED },
    { text: sig.name, italics: true, fontSize: 13, margin: [0, 2, 0, 0] },
    { margin: [0, 14, 0, 0], text: 'Signature', fontSize: 7, color: MUTED },
    imageContent ?? { text: sig.name, italics: true, fontSize: 16, margin: [0, 2, 0, 0] },
    {
      text: `Signed electronically on ${printDate(sig.signedAt)}${sig.ip ? `, IP ${sig.ip}` : ''}`,
      fontSize: 6.5,
      color: MUTED,
      margin: [0, 8, 0, 0],
    },
  ];
}

function signatureImageContent(imageUrl: string | null | undefined): Content | null {
  if (!imageUrl) return null;
  try {
    const filePath = path.join(path.resolve(env.UPLOAD_DIR), path.basename(imageUrl));
    const b64 = fs.readFileSync(filePath).toString('base64');
    return { image: `data:image/png;base64,${b64}`, width: 140, margin: [0, 2, 0, 0] };
  } catch {
    return null;
  }
}
