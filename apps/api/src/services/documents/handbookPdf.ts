import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { letterhead, renderPdfToUpload } from '../pdf';
import type { CompanyProfile } from '../invoicing';
import type { ManualTopic } from '../appManual';

/**
 * A printable "how do I…" handbook — the exact prose the assistant already
 * draws on (appManual.ts), laid out as a document. No generic
 * "text-to-PDF" helper exists in this codebase yet (contractPdf.ts and
 * quotationPdf.ts both hand-build their `content` array the same way), so
 * this follows the same pattern rather than inventing a new one.
 */

const SECTION_LABEL: Record<ManualTopic['scope'], string> = {
  shared: 'For everyone',
  office: 'Office',
  finance: 'Money',
  site: 'On site',
};

// Read order: what everyone needs first, then the more specialised sections.
const SECTION_ORDER: ManualTopic['scope'][] = ['shared', 'office', 'finance', 'site'];

export async function renderHandbookPdf(
  company: CompanyProfile,
  topics: ManualTopic[],
): Promise<string> {
  const bySection = new Map<ManualTopic['scope'], ManualTopic[]>();
  for (const topic of topics) {
    const list = bySection.get(topic.scope) ?? [];
    list.push(topic);
    bySection.set(topic.scope, list);
  }

  const content: Content[] = [
    { text: 'STAFF HANDBOOK', style: 'docTitle' },
    {
      text: 'How to use this system — generated from the same reference the AI assistant answers from.',
      style: 'companyMeta',
      margin: [0, 4, 0, 0],
    },
  ];

  for (const scope of SECTION_ORDER) {
    const topics = bySection.get(scope);
    if (!topics || topics.length === 0) continue;
    content.push({
      text: SECTION_LABEL[scope].toUpperCase(),
      style: 'sectionLabel',
      margin: [0, 22, 0, 8],
    });
    for (const topic of topics) {
      content.push({
        unbreakable: true,
        margin: [0, 0, 0, 14],
        stack: [
          { text: topic.title, bold: true, fontSize: 10.5, margin: [0, 0, 0, 4] },
          ...topic.content.split(/\n{2,}/).map(
            (para): Content => ({
              text: para,
              fontSize: 8.5,
              margin: [0, 4, 0, 0],
            }),
          ),
        ],
      });
    }
  }

  const def: TDocumentDefinitions = {
    info: { title: 'Staff Handbook', author: company.name, subject: 'How to use the system' },
    ...letterhead(company),
    content,
  };

  return renderPdfToUpload(def, 'staff-handbook');
}
