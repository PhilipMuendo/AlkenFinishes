/**
 * A maintained, static quick-reference on Kenyan tax administration — the
 * one deliberate exception to "every chat answer is built only from live
 * data this company owns" (see docs/ARCHITECTURE.md, "Adding a feature means
 * adding a lookup").
 *
 * Why a static string instead of letting the model answer from its own
 * training: a wrong number here can cost the client real money or a KRA
 * penalty, and training data goes stale the moment a Finance Act changes a
 * rate. Keeping the content in one reviewable constant means a human updates
 * it deliberately when the law changes, the same way DEFAULT_PAYROLL_CONFIG
 * in services/payroll.ts is a starting point the user is expected to check,
 * not a statement of what is currently due. The chat lookup that serves this
 * (services/chatRetrieval.ts, "kenya_tax_guide") hands it to the model as
 * FACTS like any other lookup, so the model is paraphrasing a reviewed text,
 * never inventing a rate.
 *
 * Anything this company's own PayrollConfig already governs (PAYE bands,
 * NSSF tiers, SHIF rate, Housing Levy rate) is deliberately NOT restated
 * here with a number — it points at Settings > Money & tax instead, so this
 * file can never drift out of sync with what the app is actually configured
 * to charge.
 *
 * Last reviewed: January 2026. Kenya's Finance Act typically takes effect
 * around July each year — if today is later than that, treat anything here
 * as a starting point to verify on iTax (itax.kra.go.ke), not a current fact.
 */
export const KENYA_TAX_REFERENCE = `
General Kenyan tax administration reference — last reviewed January 2026. This is background knowledge, not this company's own figures, and not tax advice: rates and thresholds are revised by Finance Acts (usually each July), so a specific number below may be out of date. Confirm anything material on iTax (itax.kra.go.ke) or with a licensed tax agent before filing or paying.

Filing platform: almost everything (PAYE, VAT, Turnover Tax, Withholding Tax, Income Tax) is filed and paid through KRA's iTax portal. NSSF and SHIF have their own portals (NSSF eSF16, SHIF/SHA portal).

Common due dates (day of the month FOLLOWING the period they cover):
- PAYE, NSSF, SHIF, Affordable Housing Levy: by the 9th.
- VAT and Withholding Tax (remittance of tax withheld): by the 20th.
- Turnover Tax (TOT): by the 20th.
- Annual Income Tax return (self-assessment, for a business on the calendar year): by 30 June of the following year.
Missing a deadline attracts both a penalty and interest that accrue independently of each other and grow monthly — check the current rates on iTax rather than assuming a fixed figure, since these are revised periodically.

VAT: standard rate 16% on most goods and services; some are zero-rated or exempt. Mandatory VAT registration applies once annual taxable turnover crosses a threshold set by KRA (in the region of KES 5,000,000 as of the last review) — confirm the current threshold before deciding whether to register.

Turnover Tax (TOT): a simplified tax for smaller resident businesses, charged on gross turnover rather than profit, generally applying to businesses within an annual turnover band roughly KES 1,000,000–25,000,000 (a business below the band is typically exempt from TOT; above it, ordinary Corporation Tax applies instead). The rate has been around 3% of gross turnover in recent years — confirm the current rate, as it has changed more than once by Finance Act.

PAYE, NSSF, SHIF, Housing Levy: this company's own configured bands and rates for these are in Settings > Money & tax and drive every payslip the app computes — always trust those over any number quoted here, since they are what the app actually charges and are the ones a supervisor or owner can check directly.

Withholding Tax (WHT): certain payments to a resident or non-resident have tax withheld at source by the payer and remitted to KRA on the payee's behalf, with a certificate issued to the payee that they use as a credit against their own tax. Common resident rates seen in recent practice: professional/management/consultancy fees around 5%, rental income withholding (for a tenant paying an agent, or for the Monthly Rental Income regime generally) commonly cited around 7.5–10%, dividends around 5%, interest around 15%. Rates roughly double for a non-resident payee and vary further by treaty and by the exact category of payment — WHT categorisation is easy to get subtly wrong, so confirm the specific rate for a specific payment type with KRA or a tax agent rather than relying on a general figure.

Corporation Tax: standard rate for a resident company has been 30% of taxable profit in recent years (higher for a branch of a non-resident company). Applies once a business is past the Turnover Tax band or otherwise not eligible for it.

None of the above should be treated as the final word for a specific filing or transaction — it is oriented context to ask the right next question, not a substitute for KRA's own guidance or a licensed tax agent's advice.
`.trim();
