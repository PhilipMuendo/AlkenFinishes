import type { Quotation, QuotationLine } from '@prisma/client';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  HAIRLINE,
  MUTED,
  letterhead,
  lineTableLayout,
  money,
  printDate,
  renderPdfToUpload,
} from '../pdf';
import type { CompanyProfile, InvoicingConfig } from '../invoicing';
import { bankBlock } from './invoicePdf';

export type QuotationWithLines = Quotation & { lines: QuotationLine[] };

/**
 * Renders a quotation from its STORED columns — same rule as the invoice: the
 * numbers a client is quoted and the numbers in the database must be the same
 * numbers, so nothing is recalculated at render time.
 */
export async function renderQuotationPdf(
  q: QuotationWithLines,
  company: CompanyProfile,
  config: InvoicingConfig,
): Promise<string> {
  const n = (v: unknown) => Number(v);
  const showVat = n(q.vatAmount) !== 0 || n(q.vatRatePct) !== 0;

  const totalRows: TableCell[][] = [
    [
      { text: 'Subtotal', style: 'totalLabel' },
      { text: money(n(q.subtotal)), style: 'totalValue' },
    ],
  ];
  if (showVat) {
    totalRows.push([
      { text: `VAT @ ${n(q.vatRatePct)}%`, style: 'totalLabel' },
      { text: money(n(q.vatAmount)), style: 'totalValue' },
    ]);
  }
  totalRows.push([
    { text: 'Quotation total', style: 'grandLabel' },
    { text: `KES ${money(n(q.total))}`, style: 'grandValue' },
  ]);

  const def: TDocumentDefinitions = {
    info: {
      title: `Quotation ${q.quotationNo ?? 'draft'}`,
      author: company.name,
      subject: q.title,
    },
    ...letterhead(company, config.footerNote),
    content: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'QUOTATION', style: 'docTitle' },
              { text: q.title, color: MUTED, fontSize: 9, margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: q.quotationNo ?? 'DRAFT — NOT ISSUED', style: 'docNumber' },
              { text: `Issued      ${printDate(q.issueDate)}`, style: 'companyMeta' },
              { text: `Valid until ${printDate(q.validUntil)}`, style: 'companyMeta' },
            ],
          },
        ],
        margin: [0, 0, 0, 18],
      },
      {
        stack: [
          { text: 'PREPARED FOR', style: 'sectionLabel', margin: [0, 0, 0, 3] },
          { text: q.clientNameSnapshot, bold: true },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 46, 34, 66, 74],
          body: [
            [
              { text: 'DESCRIPTION', style: 'tableHeader' },
              { text: 'QTY', style: 'tableHeader', alignment: 'right' },
              { text: 'UNIT', style: 'tableHeader' },
              { text: 'RATE', style: 'tableHeader', alignment: 'right' },
              { text: 'AMOUNT', style: 'tableHeader', alignment: 'right' },
            ] as TableCell[],
            ...q.lines.map((l): TableCell[] => [
              { text: l.description + (l.taxable ? '' : '  (zero-rated)') },
              { text: String(Number(n(l.quantity).toFixed(3))), alignment: 'right' },
              { text: l.unit, color: MUTED },
              { text: money(n(l.unitPrice)), alignment: 'right' },
              { text: money(n(l.lineTotal)), alignment: 'right' },
            ]),
          ],
        },
        layout: lineTableLayout,
      },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 232,
            table: { widths: ['*', 86], body: totalRows },
            layout: {
              hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
                i === node.table.body.length - 1 ? 0.75 : 0,
              vLineWidth: () => 0,
              hLineColor: () => HAIRLINE,
              paddingTop: () => 3,
              paddingBottom: () => 3,
              paddingLeft: () => 0,
              paddingRight: () => 0,
            },
          },
        ],
        margin: [0, 14, 0, 0],
      },
      ...(q.termsText
        ? ([
            { text: 'TERMS', style: 'sectionLabel', margin: [0, 22, 0, 5] },
            {
              ul: q.termsText.split('\n').filter((t) => t.trim()),
              fontSize: 8.5,
              markerColor: MUTED,
            },
          ] as Content[])
        : []),
      ...(q.notes
        ? ([
            { text: 'NOTES', style: 'sectionLabel', margin: [0, 16, 0, 3] },
            { text: q.notes, fontSize: 8.5 },
          ] as Content[])
        : []),
      ...bankBlock(company),
    ],
  };

  return renderPdfToUpload(def, `quotation-${q.quotationNo ?? q.id}`);
}
