import type { Client, Contract, Quotation, QuotationLine } from '@prisma/client';
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
import type { CompanyProfile } from '../invoicing';
import { amountInWords, toCents } from '../money';
import { dlpEnd, type PipelineConfig } from '../pipeline';

export type ContractForPdf = Contract & {
  client: Client;
  quotation: (Quotation & { lines: QuotationLine[] }) | null;
};

/**
 * Renders the contract agreement from the contract record, with the schedule of
 * works taken from the quotation it was raised against where there is one.
 *
 * Like the invoice renderer, this prints stored columns and does not
 * recalculate. The one value it derives is the sum in words, generated from the
 * same cents figure the numerals are printed from — under Kenyan practice the
 * words govern where the two disagree, so they must not be able to.
 *
 * What this produces is the copy sent for signature. Once executed, the scan
 * goes to `signedPdfUrl` and that becomes the operative document; this one
 * stays as the record of what was sent.
 */
export async function renderContractPdf(
  c: ContractForPdf,
  company: CompanyProfile,
  config: PipelineConfig,
  paymentTermsDays: number,
  footerNote?: string,
): Promise<string> {
  const n = (v: unknown) => Number(v);
  const sumCentsValue = toCents(c.originalValue);
  const dlpEnds = dlpEnd(c.practicalCompletionDate, c.defectsLiabilityMonths);

  const particulars: [string, string][] = [
    ['Contract number', c.contractNo ?? 'DRAFT — NOT ISSUED'],
    ['Contract sum', `KES ${money(n(c.originalValue))}`],
    ['Sum in words', `Kenya Shillings ${amountInWords(sumCentsValue)}`],
    ['Commencement date', printDate(c.startDate)],
    ['Contractual completion', printDate(c.expectedCompletion)],
    ['Payment terms', `${paymentTermsDays} days from date of invoice`],
    ['Retention', `${n(c.retentionPct)}% of the value of the Works, excluding VAT`],
    [
      'Defects liability period',
      `${c.defectsLiabilityMonths} months from practical completion` +
        (dlpEnds ? ` — expires ${printDate(new Date(dlpEnds))}` : ''),
    ],
  ];

  const def: TDocumentDefinitions = {
    info: {
      title: `Contract ${c.contractNo ?? 'draft'}`,
      author: company.name,
      subject: c.title,
    },
    ...letterhead(company, footerNote),
    content: [
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'CONTRACT AGREEMENT', style: 'docTitle' },
              { text: c.title, color: MUTED, fontSize: 9, margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: c.contractNo ?? 'DRAFT — NOT ISSUED', style: 'docNumber' },
              {
                text: c.signedDate ? `Signed  ${printDate(c.signedDate)}` : 'Not yet executed',
                style: 'companyMeta',
              },
            ],
          },
        ],
        margin: [0, 0, 0, 18],
      },

      // ---- Parties ----
      { text: 'THE PARTIES', style: 'sectionLabel', margin: [0, 0, 0, 6] },
      {
        columns: [
          {
            width: '*',
            stack: partyBlock('THE EMPLOYER (Client)', c.client.name, employerLines(c.client)),
          },
          { width: 20, text: '' },
          {
            width: '*',
            stack: partyBlock('THE CONTRACTOR', company.name, contractorLines(company)),
          },
        ],
      },
      {
        text:
          'This Agreement is made between the parties named above for the execution of the Works ' +
          'described below, on the particulars and conditions that follow.',
        margin: [0, 14, 0, 0],
      },

      // ---- Particulars ----
      { text: 'PARTICULARS', style: 'sectionLabel', margin: [0, 20, 0, 6] },
      {
        table: {
          widths: [150, '*'],
          body: particulars.map(([label, value]): TableCell[] => [
            { text: label, color: MUTED },
            { text: value, bold: label === 'Contract sum' || label === 'Sum in words' },
          ]),
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => HAIRLINE,
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 0,
          paddingRight: () => 8,
        },
      },

      // ---- Schedule of works ----
      ...scheduleOfWorks(c),

      // ---- Conditions ----
      ...(config.contractTermsText
        ? ([
            { text: 'CONDITIONS OF CONTRACT', style: 'sectionLabel', margin: [0, 22, 0, 6] },
            { text: config.contractTermsText, fontSize: 8.5, alignment: 'justify' },
          ] as Content[])
        : []),
      ...(c.notes
        ? ([
            { text: 'SPECIAL CONDITIONS', style: 'sectionLabel', margin: [0, 16, 0, 4] },
            { text: c.notes, fontSize: 8.5 },
          ] as Content[])
        : []),

      // ---- Execution ----
      // unbreakable: a signature block split across a page break is the classic
      // way a signed page ends up detached from the terms it was signing.
      {
        unbreakable: true,
        margin: [0, 26, 0, 0],
        stack: [
          { text: 'EXECUTED BY THE PARTIES', style: 'sectionLabel', margin: [0, 0, 0, 4] },
          {
            columns: [
              {
                width: '*',
                stack: signatureBlock('For and on behalf of the Employer', c.client.name),
              },
              { width: 28, text: '' },
              {
                width: '*',
                stack: signatureBlock('For and on behalf of the Contractor', company.name),
              },
            ],
          },
        ],
      },
    ],
  };

  return renderPdfToUpload(def, `contract-${c.contractNo ?? c.id}`);
}

function employerLines(client: Client): string[] {
  return [
    ...(client.contactPerson ? [`Attn: ${client.contactPerson}`] : []),
    ...(client.address ? client.address.split('\n') : []),
    ...[client.phone, client.email].filter((v): v is string => !!v),
    ...(client.kraPin ? [`KRA PIN: ${client.kraPin}`] : []),
  ];
}

function contractorLines(company: CompanyProfile): string[] {
  return [
    ...company.addressLines,
    ...[company.phone, company.email].filter(Boolean),
    ...(company.kraPin ? [`KRA PIN: ${company.kraPin}`] : []),
  ];
}

/** Role, then the party's legal name, then their detail lines beneath it. */
function partyBlock(role: string, name: string, lines: string[]): Content[] {
  return [
    { text: role, fontSize: 7, bold: true, color: BRAND_NAVY, characterSpacing: 0.5 },
    { text: name, bold: true, margin: [0, 3, 0, 0] },
    ...(lines.length > 0
      ? [
          {
            text: lines.join('\n'),
            style: 'companyMeta',
            margin: [0, 2, 0, 0] as [number, number, number, number],
          },
        ]
      : []),
  ];
}

function scheduleOfWorks(c: ContractForPdf): Content[] {
  const heading: Content = {
    text: 'SCHEDULE OF WORKS',
    style: 'sectionLabel',
    margin: [0, 20, 0, 6],
  };
  const lines = c.quotation?.lines ?? [];

  // A contract can be raised without a quotation behind it (a direct award, or
  // a job priced offline). The scope then rests on the title and any attached
  // BOQ rather than a priced schedule, and saying so beats an empty table.
  if (lines.length === 0) {
    return [
      heading,
      {
        text: `${c.title}${c.boqUrl ? ', as detailed in the bill of quantities issued with this Contract' : ''}.`,
        fontSize: 8.5,
      },
    ];
  }

  return [
    heading,
    {
      text: `As priced in quotation ${c.quotation!.quotationNo ?? '(draft)'} dated ${printDate(
        c.quotation!.issueDate,
      )}.`,
      style: 'companyMeta',
      margin: [0, 0, 0, 6],
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
          ...lines.map(
            (l): TableCell[] => [
              { text: l.description + (l.taxable ? '' : '  (zero-rated)') },
              { text: String(Number(Number(l.quantity).toFixed(3))), alignment: 'right' },
              { text: l.unit, color: MUTED },
              { text: money(Number(l.unitPrice)), alignment: 'right' },
              { text: money(Number(l.lineTotal)), alignment: 'right' },
            ],
          ),
        ],
      },
      layout: lineTableLayout,
    },
  ];
}

function signatureBlock(role: string, party: string): Content[] {
  return [
    { text: role, fontSize: 7.5, color: MUTED, margin: [0, 6, 0, 0] },
    { text: party, bold: true, margin: [0, 1, 0, 0] },
    ...ruledField('Name'),
    ...ruledField('Position'),
    ...ruledField('Signature'),
    ...ruledField('Date'),
    ...ruledField('Witness name'),
    ...ruledField('Witness signature'),
  ];
}

/** A rule to sign on with its caption underneath, the way a form reads. */
function ruledField(label: string): Content[] {
  return [
    {
      margin: [0, 20, 0, 0],
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: MUTED }],
    },
    { text: label, fontSize: 7, color: MUTED, margin: [0, 3, 0, 0] },
  ];
}
