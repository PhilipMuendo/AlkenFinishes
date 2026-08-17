import type { Invoice, InvoiceLine, InvoiceType } from '@prisma/client';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  BRAND_NAVY,
  HAIRLINE,
  MUTED,
  letterhead,
  lineTableLayout,
  money,
  printDate,
  renderPdfToUpload,
} from '../pdf';
import type { CompanyProfile, InvoicingConfig } from '../invoicing';

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  MOBILISATION: 'Mobilisation',
  PROGRESS_CLAIM: 'Progress Claim',
  VARIATION: 'Variation',
  FINAL_ACCOUNT: 'Final Account',
  RETENTION: 'Retention Release',
};

export type InvoiceWithLines = Invoice & { lines: InvoiceLine[] };

/**
 * Renders an invoice PDF from the invoice's STORED columns.
 *
 * This deliberately never recalculates totals: the numbers on the legal
 * document and the numbers in the database must be the same numbers, so
 * computeInvoiceTotals() runs once at save time and this only formats.
 */
export async function renderInvoicePdf(
  inv: InvoiceWithLines,
  company: CompanyProfile,
  config: InvoicingConfig,
): Promise<string> {
  const n = (v: unknown) => Number(v);
  const showVat = n(inv.vatAmount) !== 0 || n(inv.vatRatePct) !== 0;
  const showRetention = n(inv.retentionAmount) !== 0;

  const totalRows: TableCell[][] = [
    [
      { text: inv.vatInclusive ? 'Subtotal (excl. VAT)' : 'Subtotal', style: 'totalLabel' },
      { text: money(n(inv.subtotal)), style: 'totalValue' },
    ],
  ];
  // A 0% VAT line reads as an error on a non-VAT-registered invoice, so it is
  // suppressed entirely rather than printed as "VAT @ 0% — 0.00".
  if (showVat) {
    totalRows.push([
      { text: `VAT @ ${n(inv.vatRatePct)}%`, style: 'totalLabel' },
      { text: money(n(inv.vatAmount)), style: 'totalValue' },
    ]);
  }
  totalRows.push([
    { text: 'Total', style: 'totalLabel' },
    { text: money(n(inv.grossTotal)), style: 'totalValue' },
  ]);
  if (showRetention) {
    totalRows.push([
      { text: `Less retention @ ${n(inv.retentionRatePct)}% of subtotal`, style: 'totalLabel' },
      { text: `(${money(n(inv.retentionAmount))})`, style: 'totalValue' },
    ]);
  }
  totalRows.push([
    { text: 'Amount payable', style: 'grandLabel' },
    { text: `KES ${money(n(inv.netPayable))}`, style: 'grandValue' },
  ]);

  const def: TDocumentDefinitions = {
    info: {
      title: `Invoice ${inv.invoiceNo ?? 'draft'}`,
      author: company.name,
      subject: INVOICE_TYPE_LABEL[inv.type],
    },
    ...letterhead(company, config.footerNote),
    content: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: company.vatRegistered ? 'TAX INVOICE' : 'INVOICE', style: 'docTitle' },
              {
                text: INVOICE_TYPE_LABEL[inv.type] + (inv.title ? ` — ${inv.title}` : ''),
                color: MUTED,
                fontSize: 9,
                margin: [0, 2, 0, 0],
              },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: inv.invoiceNo ?? 'DRAFT — NOT ISSUED', style: 'docNumber' },
              { text: `Issued  ${printDate(inv.issueDate)}`, style: 'companyMeta' },
              { text: `Due     ${printDate(inv.dueDate)}`, style: 'companyMeta' },
            ],
          },
        ],
        margin: [0, 0, 0, 18],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'BILL TO', style: 'sectionLabel', margin: [0, 0, 0, 3] },
              { text: inv.clientName, bold: true },
              ...(inv.clientAddress
                ? [
                    {
                      text: inv.clientAddress,
                      style: 'companyMeta',
                      margin: [0, 1, 0, 0] as [number, number, number, number],
                    },
                  ]
                : []),
              ...(inv.clientKraPin
                ? [{ text: `KRA PIN: ${inv.clientKraPin}`, style: 'companyMeta' }]
                : []),
            ],
          },
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
            ...inv.lines.map((l): TableCell[] => [
              { text: l.description + (l.taxable ? '' : '  (zero-rated)') },
              { text: trimQty(n(l.quantity)), alignment: 'right' },
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
      ...(inv.notes
        ? ([
            { text: 'NOTES', style: 'sectionLabel', margin: [0, 22, 0, 3] },
            { text: inv.notes, fontSize: 8.5 },
          ] as Content[])
        : []),
      ...bankBlock(company),
    ],
  };

  return renderPdfToUpload(def, `invoice-${inv.invoiceNo ?? inv.id}`);
}

/** Quantities are Decimal(12,3); drop trailing zeros so "120.000" prints as "120". */
function trimQty(q: number): string {
  return String(Number(q.toFixed(3)));
}

export function bankBlock(company: CompanyProfile): Content[] {
  const b = company.bank;
  const rows = (
    [
      ['Bank', [b.name, b.branch].filter(Boolean).join(' — ')],
      ['Account name', b.accountName],
      ['Account number', b.accountNo],
      ['SWIFT', b.swift],
      ['M-Pesa paybill', b.mpesaPaybill],
    ] as [string, string][]
  ).filter(([, v]) => !!v);
  if (rows.length === 0) return [];

  return [
    {
      margin: [0, 24, 0, 0],
      table: {
        widths: ['*'],
        body: [
          [
            {
              border: [false, true, false, false],
              margin: [0, 10, 0, 0],
              stack: [
                { text: 'PAYMENT DETAILS', style: 'sectionLabel', margin: [0, 0, 0, 5] },
                {
                  columns: rows.map(([label, value]) => ({
                    width: 'auto',
                    margin: [0, 0, 22, 0] as [number, number, number, number],
                    stack: [
                      { text: label, style: 'companyMeta' },
                      { text: value, fontSize: 8.5, bold: true },
                    ],
                  })),
                },
              ],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.75,
        vLineWidth: () => 0,
        hLineColor: () => BRAND_NAVY,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
    },
  ];
}
