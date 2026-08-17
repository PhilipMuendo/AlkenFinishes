import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PdfPrinter from 'pdfmake/src/printer';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { env } from '../config/env';
import { fileUrl } from '../middleware/upload';
import type { CompanyProfile } from './invoicing';

/**
 * pdfmake over pdfkit, chosen because the API runs on node:22-alpine on a
 * small VPS that also hosts Postgres and nginx. A headless-Chromium renderer
 * would add ~300MB to the image and 150-300MB RSS per render, which is the
 * thing that would OOM the box. pdfmake is pure JS, ~20-40MB per render, and
 * gives declarative tables with header rows that repeat across page breaks —
 * exactly what an invoice needs.
 *
 * dist/services/pdf.js -> apps/api/assets, and src/services/pdf.ts -> the
 * same, so this path is correct under both `tsx` in dev and `node dist` in
 * production.
 */
const ASSETS = path.join(__dirname, '../../assets');

const FONTS = {
  Roboto: {
    normal: path.join(ASSETS, 'fonts/Roboto-Regular.ttf'),
    bold: path.join(ASSETS, 'fonts/Roboto-Medium.ttf'),
    italics: path.join(ASSETS, 'fonts/Roboto-Italic.ttf'),
    bolditalics: path.join(ASSETS, 'fonts/Roboto-MediumItalic.ttf'),
  },
};

// Fail at boot, not at the owner's first invoice. The runtime Docker stage
// copies a subset of the repo, so a missing COPY for apps/api/assets would
// otherwise surface as a 500 in production while working fine in dev.
for (const file of Object.values(FONTS.Roboto)) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `PDF font missing: ${file} — is apps/api/assets copied into the runtime image?`,
    );
  }
}

const printer = new PdfPrinter(FONTS);

/**
 * Renders a pdfmake definition into UPLOAD_DIR and returns the UNSIGNED
 * '/uploads/<name>' path.
 *
 * Callers store that unsigned path and run it through signFileUrl() on the way
 * out, exactly like an uploaded file — so generated PDFs are private, reachable
 * only through an expiring HMAC link served by serveUploads(), and need no
 * changes to app.ts, nginx, or the upload middleware.
 */
export function renderPdfToUpload(def: TDocumentDefinitions, hint: string): Promise<string> {
  const safe = hint.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safe}.pdf`;
  const dest = path.join(path.resolve(env.UPLOAD_DIR), filename);

  return new Promise<string>((resolve, reject) => {
    const doc = printer.createPdfKitDocument(def);
    const out = fs.createWriteStream(dest);
    doc.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve(fileUrl(filename)));
    doc.pipe(out);
    doc.end();
  });
}

// ---- Shared document furniture ----

export const BRAND_NAVY = '#1e3c66';
export const INK = '#0f172a';
export const MUTED = '#64748b';
export const HAIRLINE = '#e2e8f0';

/** Reads the uploaded logo off disk as a data URI. Never fetched over HTTP. */
function logoDataUri(company: CompanyProfile): string | null {
  if (!company.logoUrl) return null;
  try {
    const file = path.join(
      path.resolve(env.UPLOAD_DIR),
      path.basename(company.logoUrl.split('?')[0]),
    );
    const ext = path.extname(file).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null; // a missing logo must never block issuing an invoice
  }
}

/**
 * Page furniture shared by every generated document: letterhead, footer with
 * KRA PIN and page numbers, and the base style dictionary.
 */
export function letterhead(
  company: CompanyProfile,
  footerNote?: string,
): Pick<
  TDocumentDefinitions,
  'header' | 'footer' | 'styles' | 'defaultStyle' | 'pageMargins' | 'pageSize'
> {
  const logo = logoDataUri(company);

  return {
    pageSize: 'A4',
    pageMargins: [40, logo ? 104 : 92, 40, 64],
    header: () => ({
      margin: [40, 28, 40, 0],
      columns: [
        {
          width: '*',
          stack: [
            ...(logo
              ? [
                  {
                    image: logo,
                    fit: [132, 38] as [number, number],
                    margin: [0, 0, 0, 6] as [number, number, number, number],
                  },
                ]
              : [{ text: company.name, style: 'companyName' }]),
            { text: company.addressLines.join('\n'), style: 'companyMeta' },
          ],
        },
        {
          width: 'auto',
          alignment: 'right',
          stack: [
            ...(logo ? [{ text: company.name, style: 'companyName' }] : []),
            {
              text: [company.phone, company.email].filter(Boolean).join('  ·  '),
              style: 'companyMeta',
            },
            ...(company.kraPin
              ? [{ text: `KRA PIN: ${company.kraPin}`, style: 'companyMeta' }]
              : []),
          ],
        },
      ],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 0],
      columns: [
        { width: '*', text: footerNote ?? '', style: 'footerNote' },
        {
          width: 'auto',
          alignment: 'right',
          text: `Page ${currentPage} of ${pageCount}`,
          style: 'footerNote',
        },
      ],
    }),
    defaultStyle: { font: 'Roboto', fontSize: 9, color: INK, lineHeight: 1.25 },
    styles: {
      companyName: { fontSize: 12, bold: true, color: BRAND_NAVY },
      companyMeta: { fontSize: 7.5, color: MUTED, lineHeight: 1.3 },
      docTitle: { fontSize: 18, bold: true, color: BRAND_NAVY },
      docNumber: { fontSize: 10, bold: true, color: INK },
      sectionLabel: { fontSize: 7, bold: true, color: MUTED, characterSpacing: 0.6 },
      tableHeader: { fontSize: 8, bold: true, color: MUTED, characterSpacing: 0.4 },
      totalLabel: { fontSize: 9, color: MUTED, alignment: 'right' },
      totalValue: { fontSize: 9, alignment: 'right' },
      grandLabel: { fontSize: 10, bold: true, color: BRAND_NAVY, alignment: 'right' },
      grandValue: { fontSize: 11, bold: true, color: BRAND_NAVY, alignment: 'right' },
      footerNote: { fontSize: 7, color: MUTED },
    },
  };
}

/**
 * Borderless table layout with a single rule under the header and hairlines
 * between rows — matches the app's table styling rather than pdfmake's
 * default boxed grid.
 */
export const lineTableLayout = {
  hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
    i === 1 || i === node.table.body.length ? 0.75 : 0.5,
  vLineWidth: () => 0,
  hLineColor: (i: number) => (i === 1 ? MUTED : HAIRLINE),
  paddingTop: () => 5,
  paddingBottom: () => 5,
  paddingLeft: () => 0,
  paddingRight: () => 8,
};

/** KES money for print: thousands separators, always 2dp, no currency symbol. */
export function money(n: number): string {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function printDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: env.APP_TIMEZONE,
  }).format(d);
}
