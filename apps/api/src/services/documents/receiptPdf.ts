import type { Invoice, Payment, PaymentMethod } from '@prisma/client';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { BRAND_NAVY, MUTED, letterhead, money, printDate, renderPdfToUpload } from '../pdf';
import type { CompanyProfile, InvoicingConfig } from '../invoicing';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  MPESA: 'M-Pesa',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export type PaymentForReceipt = Payment & {
  invoice: Pick<Invoice, 'invoiceNo' | 'netPayable'> | null;
  project: { name: string; clientName: string };
};

/**
 * OUR official receipt acknowledging money received — distinct from the
 * client's uploaded bank slip on Payment.receiptUrl, which is their proof they
 * sent it. Both documents coexist on a payment and are labelled separately in
 * the UI.
 */
export async function renderReceiptPdf(
  p: PaymentForReceipt,
  company: CompanyProfile,
  config: InvoicingConfig,
  balanceAfter: number | null,
): Promise<string> {
  const amount = Number(p.amount);

  const detailRows = (
    [
      ['Received from', p.project.clientName],
      ['Project', p.project.name],
      ['Payment date', printDate(p.paymentDate)],
      ['Method', PAYMENT_METHOD_LABEL[p.method]],
      ...(p.bankName ? [['Bank', p.bankName]] : []),
      ...(p.referenceNo ? [['Reference', p.referenceNo]] : []),
      ...(p.invoice?.invoiceNo ? [['Applied to invoice', p.invoice.invoiceNo]] : []),
    ] as [string, string][]
  ).filter(([, v]) => !!v);

  const def: TDocumentDefinitions = {
    info: {
      title: `Receipt ${p.receiptNo ?? ''}`,
      author: company.name,
      subject: 'Payment receipt',
    },
    ...letterhead(company, config.footerNote),
    content: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'OFFICIAL RECEIPT', style: 'docTitle' },
              {
                text: 'Acknowledgement of payment received',
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
              { text: p.receiptNo ?? '—', style: 'docNumber' },
              { text: `Issued  ${printDate(p.createdAt)}`, style: 'companyMeta' },
            ],
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // The amount is the point of the document, so it gets the emphasis.
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                border: [false, false, false, false],
                fillColor: '#f8fafc',
                margin: [14, 12, 14, 12],
                stack: [
                  { text: 'AMOUNT RECEIVED', style: 'sectionLabel', margin: [0, 0, 0, 4] },
                  { text: `KES ${money(amount)}`, fontSize: 21, bold: true, color: BRAND_NAVY },
                ],
              },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 18],
      },

      {
        table: {
          widths: [120, '*'],
          body: detailRows.map(([label, value]) => [
            { text: label, style: 'companyMeta', margin: [0, 2, 0, 2] },
            { text: value, fontSize: 9, margin: [0, 2, 0, 2] },
          ]),
        },
        layout: 'noBorders',
      },

      ...(balanceAfter !== null
        ? ([
            {
              margin: [0, 16, 0, 0],
              text:
                balanceAfter > 0
                  ? `Balance remaining on invoice ${p.invoice?.invoiceNo ?? ''}: KES ${money(balanceAfter)}`
                  : `Invoice ${p.invoice?.invoiceNo ?? ''} is now settled in full.`,
              fontSize: 9,
              color: MUTED,
            },
          ] as Content[])
        : []),

      ...(p.notes
        ? ([
            { text: 'NOTES', style: 'sectionLabel', margin: [0, 20, 0, 3] },
            { text: p.notes, fontSize: 8.5 },
          ] as Content[])
        : []),

      {
        text: 'This is a computer-generated receipt and is valid without a signature.',
        style: 'companyMeta',
        margin: [0, 28, 0, 0],
      },
    ],
  };

  return renderPdfToUpload(def, `receipt-${p.receiptNo ?? p.id}`);
}
