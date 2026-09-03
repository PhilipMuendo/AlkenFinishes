import { prisma } from '../lib/prisma';
import { companyFinancials } from './finance';

/**
 * Corporation Tax on the company itself — the one Kenyan tax obligation this
 * app previously tracked nowhere. VAT, withholding and payroll are all about
 * money moving through the business; this is about tax on its own profit.
 *
 * Off by default, same convention as PurchaseTaxConfig/StaffTaxConfig/
 * PayrollConfig: nothing is assumed due until a human switches it on and
 * confirms the rate.
 */
export interface IncomeTaxConfig {
  enabled: boolean;
  ratePct: number;
}

export const DEFAULT_INCOME_TAX_CONFIG: IncomeTaxConfig = {
  enabled: false,
  ratePct: 30, // Kenyan resident-company standard rate, as of the last review — see kenyaTaxReference.ts
};

export async function getIncomeTaxConfig(): Promise<IncomeTaxConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'incomeTax' } });
  return { ...DEFAULT_INCOME_TAX_CONFIG, ...((row?.value ?? {}) as Partial<IncomeTaxConfig>) };
}

/**
 * The four statutory instalment dates for a tax year, on a calendar-year
 * basis (the ordinary case for a Kenyan business with no different financial
 * year end). Defaults only — every record made from these stays freely
 * editable, since the exact day is set by KRA and can shift.
 */
function defaultInstalmentDueDates(taxYear: number): Date[] {
  return [
    new Date(taxYear, 3, 20), // 20 April
    new Date(taxYear, 5, 20), // 20 June
    new Date(taxYear, 8, 20), // 20 September
    new Date(taxYear, 11, 20), // 20 December
  ];
}

/**
 * Find-or-create the four instalments and the annual return for a tax year.
 *
 * The instalments are seeded once, with dueDate defaults and a zero estimate
 * — nothing here guesses at what the company owes. The return's
 * `taxableProfitEstimate` is seeded ONCE from companyFinancials() as a
 * starting suggestion (it excludes company expenses and any prior-year
 * carry-forward, so it is a prompt to check, not a filed figure) and is never
 * touched again by this function once the row exists, so a user's correction
 * to it can never be silently clobbered by a later call.
 */
export async function ensureYearRecords(taxYear: number, userId: string) {
  const existingInstalments = await prisma.incomeTaxInstalment.findMany({
    where: { taxYear },
    orderBy: { instalmentNo: 'asc' },
  });
  if (existingInstalments.length < 4) {
    const have = new Set(existingInstalments.map((i) => i.instalmentNo));
    const dueDates = defaultInstalmentDueDates(taxYear);
    const toCreate = [1, 2, 3, 4].filter((n) => !have.has(n));
    await prisma.$transaction(
      toCreate.map((n) =>
        prisma.incomeTaxInstalment.create({
          data: {
            taxYear,
            instalmentNo: n,
            dueDate: dueDates[n - 1],
            createdById: userId,
          },
        }),
      ),
    );
  }

  let ret = await prisma.incomeTaxReturn.findUnique({ where: { taxYear } });
  if (!ret) {
    const fin = await companyFinancials();
    ret = await prisma.incomeTaxReturn.create({
      data: {
        taxYear,
        taxableProfitEstimate: fin.totals.estimatedProfit,
        createdById: userId,
      },
    });
  }

  const instalments = await prisma.incomeTaxInstalment.findMany({
    where: { taxYear },
    orderBy: { instalmentNo: 'asc' },
  });

  return { instalments, return: ret };
}
