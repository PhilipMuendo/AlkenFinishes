import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { HAIRLINE, letterhead, lineTableLayout, money, renderPdfToUpload } from '../pdf';
import type { CompanyProfile } from '../invoicing';

/**
 * One flexible tabular layout for the report pack, rather than eight bespoke
 * hand-built templates. What these reports actually need is the company's
 * data laid out cleanly and printably — a subtitle, a table, optional summary
 * lines underneath. The invoice/quotation/contract templates earn their own
 * bespoke design because they are legal documents with a fixed convention to
 * follow; an internal report does not carry that requirement.
 */

export type ReportColumn = { header: string; width?: number | 'auto' | '*'; align?: 'left' | 'right' };

export interface ReportSection {
  heading?: string;
  columns: ReportColumn[];
  rows: (string | number)[][];
  /** Right-aligned numeric columns are formatted with money() when this is set. */
  moneyColumns?: number[];
}

export interface SummaryLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

export async function renderReportPdf(opts: {
  title: string;
  subtitle: string;
  company: CompanyProfile;
  generatedFor: string; // "Runda Family Home · 01 Jul – 31 Jul 2026"
  sections: ReportSection[];
  summary?: SummaryLine[];
  footerNote?: string;
}): Promise<string> {
  const content: Content[] = [
    {
      stack: [
        { text: opts.title, style: 'docTitle' },
        { text: opts.subtitle, color: '#64748b', fontSize: 9, margin: [0, 2, 0, 0] },
        { text: opts.generatedFor, style: 'companyMeta', margin: [0, 6, 0, 0] },
      ],
      margin: [0, 0, 0, 18],
    },
  ];

  for (const section of opts.sections) {
    if (section.heading) {
      content.push({ text: section.heading, style: 'sectionLabel', margin: [0, 16, 0, 6] });
    }
    if (section.rows.length === 0) {
      content.push({ text: 'Nothing to show for this period.', italics: true, color: '#64748b', fontSize: 9 });
      continue;
    }
    const widths = section.columns.map((c) => c.width ?? '*');
    const header: TableCell[] = section.columns.map((c) => ({
      text: c.header,
      style: 'tableHeader',
      alignment: c.align ?? 'left',
    }));
    const body: TableCell[][] = section.rows.map((row) =>
      row.map((cell, i): TableCell => {
        const isMoney = section.moneyColumns?.includes(i);
        const align = section.columns[i]?.align ?? (isMoney ? 'right' : 'left');
        const text = isMoney ? money(Number(cell)) : String(cell);
        return { text, alignment: align };
      }),
    );
    content.push({
      table: { headerRows: 1, widths, body: [header, ...body] },
      layout: lineTableLayout,
    });
  }

  if (opts.summary?.length) {
    content.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 260,
          table: {
            widths: ['*', 100],
            body: opts.summary.map((s): TableCell[] => [
              { text: s.label, style: s.emphasis ? 'grandLabel' : 'totalLabel' },
              { text: s.value, style: s.emphasis ? 'grandValue' : 'totalValue' },
            ]),
          },
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
      margin: [0, 16, 0, 0],
    });
  }

  // Landscape when any section has enough columns to want the extra width —
  // a statement or attendance table cramped into portrait is unreadable.
  const wide = opts.sections.some((s) => s.columns.length > 5);

  const def: TDocumentDefinitions = {
    info: { title: opts.title, author: opts.company.name, subject: opts.subtitle },
    ...letterhead(opts.company, opts.footerNote),
    pageOrientation: wide ? 'landscape' : 'portrait',
    content,
  };

  return renderPdfToUpload(def, opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}
