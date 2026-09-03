import type { Scope } from './chatRetrieval';

/**
 * The "how do I…" manual — hand-authored, reviewed prose about USING the
 * system, wired into the assistant exactly like `KENYA_TAX_REFERENCE`
 * (kenyaTaxReference.ts): a static reference the model can choose instead of
 * a live-data lookup, when the question is about the app itself rather than
 * this company's own figures. See chatRetrieval.ts for how each entry below
 * becomes a `Lookup`.
 *
 * Each topic's `description` states both what it covers and what it does
 * NOT cover, so the planner reaches for the right topic instead of the
 * closest-sounding one — the same discipline `kenya_tax_guide`'s
 * description already uses to stay out of `tax_position`'s way.
 */
export interface ManualTopic {
  /** Becomes the lookup name `howto_${key}`. */
  key: string;
  /** A short heading — used as this topic's section title in the printable handbook. */
  title: string;
  scope: Scope;
  description: string;
  content: string;
}

export const MANUAL_TOPICS: ManualTopic[] = [
  // ---- office ----
  {
    key: 'team',
    title: 'Team & user accounts',
    scope: 'office',
    description:
      'How to use Team (/admin/team) — adding a user, choosing a role (Site Supervisor, Accountant, Superadmin), resetting a password, disabling vs deleting an account. NOT what each role can see — that is just how the app already behaves for them.',
    content: `Team (/admin/team) is Superadmin-only.

Add a user: "Add user" → full name, email, phone, a temporary password (min 8 characters, shown in plain text — hand it to them directly, they are not emailed automatically), and a role. Role defaults to "Site Supervisor" and must be changed deliberately for "Accountant" or "Superadmin" — nothing is elevated by accident.

Reset a password: the key icon on a row opens "Reset password" — same rule, share it directly.

Disable vs delete: the row action toggles between "Disable" and "Enable" — disabling blocks sign-in but keeps their history (assigned sites, submitted reports, audit trail) and is the recommended choice for anyone who might come back. Delete is permanent and irreversible; use it only for an account that will never be needed again.

Assigned sites shows on each row (comma-joined project names) for supervisors. The Accountant role sees Receivables, Payables, Company Expenses, Tax, Payroll and a money-only view of each site, but not Sites, Team, Leads, Contracts, Equipment or Calendar.`,
  },
  {
    key: 'crm_pipeline',
    title: 'Clients, leads & quotations',
    scope: 'office',
    description:
      'How the pre-contract pipeline works — Clients register, the Leads kanban board (stages, marking lost), and Quotations (draft, send, client accepts/declines, raise a contract). NOT how to create a Contract directly, or a Site/Project — see howto_contracts and howto_sites_equipment.',
    content: `Clients (/admin/clients) is the register every lead, quotation, contract and site draws from. "Add client" takes name, contact person, phone, email, KRA PIN, address, notes. Renaming a client here does not change documents already issued — those keep the name as it stood at the time.

Leads (/admin/leads) is a kanban board: New → Contacted → Site visit → Quoted, each card advancing one stage at a time via a button labelled with the next stage. "Lost" is reachable from any open stage and requires a reason. A lead can only be deleted while it has no quotations against it.

Quotations (/admin/quotations): "New quotation" — optionally against a lead (auto-fills client/title), pick a client, add priced line items, set a VAT rate and validity date, write terms. Lifecycle: Draft → "Send to client" → Sent → either "Client accepted" or "Client declined" (requires a reason, and this also marks the underlying lead as lost). Only a Draft can be edited or deleted. Once accepted, "Raise contract" turns it into a Contract with the Contract Sum set to the quotation's subtotal (excluding VAT) — one contract per quotation.`,
  },
  {
    key: 'contracts',
    title: 'Contracts & signatures',
    scope: 'office',
    description:
      'How to issue a contract, get it signed (send an e-signature link, or record a scanned wet-ink copy), raise a variation, and convert it into a running site. NOT how quotations become contracts in the first place — see howto_crm_pipeline.',
    content: `Contracts (/admin/contracts, Superadmin-only): a Draft contract (either raised directly or from an accepted quotation) is made real by "Issue for signature" — this allocates a contract number and renders the PDF that goes out.

Getting it signed, two ways:
- "Send for e-signature" generates a one-time link (copied to your clipboard automatically, also shown in a dialog to copy again) and opens for 14 days or until used once. Share it however you'd normally reach the client — WhatsApp, email; there is no send-integration in the app, sharing stays a manual step. The client opens it with no login of their own, reviews the unsigned PDF, types or draws their signature, ticks a consent box, and submits. This records their name, a timestamp, their IP and device, embeds the signature into a freshly rendered "executed" PDF, and flips the contract straight to Signed.
- "Record signature (scanned copy)" is the older manual route — enter the date signed and optionally attach a scan of a wet-ink signed copy. Both routes end at the same Signed status; use whichever fits how the client actually signed.

Once Signed, "Open the site" converts it into a running Project. A Variation (raised from the contract's detail view) only moves the Contract Sum once approved — a pending one is visible but not yet counted.`,
  },
  {
    key: 'sites_equipment',
    title: 'Sites & equipment',
    scope: 'office',
    description:
      'How to create a new site/project, change its status or supervisor, and manage Equipment (tools) — adding, transferring between sites, retiring. NOT the money side of a site (budget, invoices, payments) — that is on the site\'s own Money tabs, not covered here.',
    content: `Sites (/admin/sites): "New site" creates a project directly — name, client name (typed free text here, not linked to the Clients register the way a quotation-raised contract is), location, contract value, start/expected-completion dates, initial status (Planning or Active), and a supervisor. A site created this way has no contract behind it yet — "link a contract to it so claims can be raised" is the reminder shown on creation; the alternative is issuing a Contract first and using "Open the site" from there.

Inside a site (ProjectDetail), the header lets you change Status (Planning/Active/On Hold/Completed/Cancelled) and Supervisor (any active user with the Supervisor role) — both save immediately, no separate submit step.

Equipment (/admin/equipment): "New tool" registers an item with a quantity, unit, and current location (a site or "Central store"). "Transfer" moves it to another site and always requires a photo of the delivery as proof — the button is disabled unless the tool's status is Active. Status (Active/Maintenance/Retired) is a plain dropdown on each card, saved instantly. A History icon shows every past transfer with its proof photo.`,
  },
  {
    key: 'calendar',
    title: 'Calendar',
    scope: 'office',
    description:
      'How the Calendar works — which event types can be added by hand vs are computed automatically from other records. NOT how to change a deadline that already shows on the calendar — that is done on the source record, not here.',
    content: `Calendar (/admin/calendar) mixes two kinds of entries. "New event" can only create seven types: Milestone, Inspection, Delivery, Meeting, Site visit, Client appointment, Other — with a title, date, and an optional site (leave blank for company-wide).

Six more types appear on the calendar but cannot be added or deleted here at all, because they are derived automatically from other records: project deadlines, payroll dates, equipment service dates, birthdays, retention due dates, and warranty expiry. The way to move one of these is to edit the record it comes from (e.g. a project's expected completion date) — moving the underlying record moves the calendar entry with it.

Only manually-added events show a delete (trash) icon, and deleting one is silent — nobody is notified.`,
  },
  {
    key: 'settings',
    title: 'Settings',
    scope: 'office',
    description:
      'What each tab in Settings controls — Company letterhead, Documents (invoicing/quotation/contract numbering and wording), Money & tax (budget thresholds, labour cost source, purchase/staff withholding tax, payroll deductions), Attendance devices, the Assistant allowance, and the Audit log. NOT this company\'s current configured rates — ask a specific lookup like tax_position or payroll_recent for those.',
    content: `Settings (/admin/settings, Superadmin-only) is six tabs, each addressable by URL (/admin/settings/{section}):

Company — the legal letterhead printed on every invoice/receipt: logo, registered name, address, KRA PIN, VAT registration, and the bank/M-Pesa details shown on invoices. The logo saves the moment you pick a file; everything else needs "Save letterhead".

Documents — invoice/receipt number prefixes and padding, VAT rate, default retention, payment terms, footer note; and separately, quotation/contract/site number prefixes, quotation validity window, standard quotation terms, and the conditions of contract text. Changing wording here only affects documents issued from now on — anything already issued keeps what it went out with.

Money & tax — five cards: budget health thresholds (when a category shows Watch vs At risk), which cost source drives Labour actuals (attendance only / expenses only / both, to avoid double-counting), tax on purchases (input VAT rate, whether you're an appointed withholding agent, default WHT rates), tax on staff hourly payments (a separate withholding toggle for fundis, distinct from formal Payroll's PAYE), and Payroll deductions (PAYE bands, personal relief, SHIF, Housing Levy — off by default, so nothing is withheld until switched on).

Attendance — registering fingerprint devices (ZKTeco push terminals, Suprema via BioStar 2, or uAttend CSV import), and resolving sync issues (an unrecognised fingerprint, or a punch at the wrong site).

Assistant — the shared daily AI call allowance, split between the chat assistant and the work that depends on AI (receipt reading, report drafting) — the assistant is deliberately the first to be throttled once the daily budget runs low.

Audit log — an immutable, paginated record of every create/update/delete with who did it and when.`,
  },
  // ---- finance ----
  {
    key: 'expenses_approval',
    title: 'Approving expenses',
    scope: 'finance',
    description:
      'How the office approves, rejects and pays an expense claim — on a site or via Company Expenses for spend not tied to any site. NOT how a supervisor submits their own claim from site — see howto_submitting_expenses.',
    content: `A pending expense claim shows on a project's Expenses tab, or on Company Expenses (/admin/company-expenses) for spend that isn't tied to any site — uniforms, office supplies, tools bought ahead of a future job. Both use the same table and the same actions: while a claim is Pending, "Approve", "Reject" (requires a reason) or the trash icon to delete it outright.

Only a claim with a supplier attached carries a payables balance ("Owed" column). "Pay" opens a dialog pre-filled with a suggested settlement — cash to the supplier plus any withholding tax due, worked out on the ex-VAT balance at the configured rate — every figure is editable before recording. A payment can be recorded before or after approval; paying does not wait on the approval decision. Once fully settled the row shows "Paid"; part-payments show what's still outstanding and whether it's overdue.

Company Expenses is reached the same way and behaves identically — the only difference is there's no project attached, so it never touches any site's budget, but a supplier attached to one still shows up correctly on Payables.`,
  },
  {
    key: 'payables',
    title: 'Suppliers & payables',
    scope: 'finance',
    description:
      'How to manage Suppliers and record a supplier payment, including withholding tax. NOT how to approve the underlying expense claim that put a bill on the ledger — see howto_expenses_approval.',
    content: `Payables (/admin/payables) lists every supplier and, at the top, who is owed the most and how overdue it is, aged into buckets (current, 1–30, 31–60, 61–90, 90+ days). "Add supplier" takes a name, contact, KRA PIN and notes.

A supplier's balance is built entirely from expense claims with that supplier attached and a supplier's own detail view lists every bill against them with its own position. Recording a payment happens from the expense itself (see "Approving expenses") — the payables list is where you see who to pay next, not where the payment is entered.

Withholding tax on a payment is suggested automatically (when the company is configured as a withholding agent in Settings) but always editable — it's calculated on the ex-VAT outstanding balance, never on a VAT-inclusive figure. A payment can be deleted only if the withheld tax on it hasn't already been remitted to KRA.`,
  },
  {
    key: 'receivables',
    title: 'Receivables',
    scope: 'finance',
    description:
      "How to use Receivables — the cross-project invoice register, viewing an invoice's PDF, and what the aging figures mean. NOT how to raise a new invoice on a specific project — that happens from the project's own Invoices tab.",
    content: `Receivables (/admin/receivables) is the company-wide register of every issued invoice — filterable by site, status, and whether it's overdue — with total outstanding and an aging breakdown at the top. Each row has a "View" action that opens the invoice's PDF directly from the register, without needing to go into the project.

New invoices are raised from inside a specific project (its own Invoices/Money tab), not from this company-wide page — Receivables is the read/collect view across everything already issued, not a place to create one.`,
  },
  {
    key: 'tax',
    title: 'Tax',
    scope: 'finance',
    description:
      "How to use the Tax page — this company's current VAT/withholding position and outstanding certificates. NOT how the underlying PAYE/NSSF/SHIF/withholding rates are configured — that's Settings > Money & tax, covered by howto_settings. NOT general Kenyan tax rules/deadlines — that's kenya_tax_guide.",
    content: `Tax (/admin/tax, Superadmin and Accountant) shows this company's current position: output VAT charged, input VAT on approved purchase bills (only those with a valid tax invoice are reclaimable), and withholding tax due both ways — what's been withheld from suppliers/staff and what clients have withheld from this company.

Outstanding withholding certificates are tracked here too — a certificate can be marked received once it arrives, and a supplier's withheld tax marked remitted once paid over to KRA (which then blocks deleting that payment, since the money is already gone and the certificate issued).

This page reflects only what's actually in the books — it doesn't compute a return or file anything; it's the working figures to take to iTax, not a substitute for it.`,
  },
  {
    key: 'payroll',
    title: 'Payroll',
    scope: 'finance',
    description:
      'How to run Payroll for hourly fundis — preview, create a draft run, finalise it. NOT withholding tax on an individual off-payroll staff payment (recorded from Workers/Fundis instead) — see howto_settings for where that toggle lives.',
    content: `Payroll (/admin/payroll, Superadmin and Accountant) runs the formal pay cycle for fundis whose hours are tracked by attendance. A run is previewed first — gross wages from accrued hours, then, only if "Apply statutory deductions" is switched on in Settings > Money & tax, PAYE (banded), personal relief, SHIF and Housing Levy (employee and employer shares) worked out per fundi. Nothing is withheld while that setting stays off — every fundi is paid their full wage.

Once the figures look right, save the run as a draft, then finalise it — finalising is what locks the numbers in and marks the period paid. PAYE and withholding tax on an individually-paid claim (via Workers/Fundis, outside formal Payroll) are alternative treatments of the same income — a fundi run through Payroll should not also have withholding tax struck on separate payments.`,
  },
  {
    key: 'business_reports',
    title: 'Business reports',
    scope: 'finance',
    description:
      "How to generate a Business Report (a downloadable PDF snapshot for a client, bank or file) from a project's Export tab — the 8 available types and which ones use a date range. NOT the site-ops Reports feed of daily/weekly updates — see howto_site_reports.",
    content: `Every project has an Export tab (Resources > Export in ProjectDetail; the Accountant's project view has an equivalent Reports tab) offering downloadable report types: Financial Summary, Progress Report, Attendance & Labour, Expense Report, Client Statement, Retention & Receivables, Variation Orders, and Site Diary Digest.

Attendance, Expenses and Site Diary Digest use the From/To date range set at the top of the panel; the other five are always a point-in-time snapshot regardless of the range. Clicking Download generates the file and opens it in a new tab — nothing is recomputed beyond what the live pages already show, it's purely a clean, dateable export of existing figures.

The Accountant's project view only offers the money-flavoured types (Financial Summary, Client Statement, Retention & Receivables, Variation Orders, Expense Report) — Progress, Attendance and Site Diary stay Superadmin-only, since those are operational rather than financial records.`,
  },
  // ---- site ----
  {
    key: 'site_reports',
    title: 'Daily & weekly reports',
    scope: 'site',
    description:
      "How to file a daily or weekly site report, and where to browse everything already filed across every site. NOT the downloadable Business Reports export — see howto_business_reports.",
    content: `A daily report is filed from a site's Daily report tab (or the "File today's report" shortcut on the supervisor's Today screen): work completed and fundis present are required; materials used, challenges, weather, visitors, delays and up to 6 photos are optional. An AI "Write it up for me" draft button, where available, drafts the text for you to check before saving — it never submits on your own. Changing the report's date clears any draft in progress, so a draft doesn't accidentally get filed under the wrong day.

A weekly report is filed against a week-ending Sunday (any date picked snaps to that week's Sunday) — summary, milestones, issues/blockers, next week's plan, up to 6 photos. Submitting again for a week that already has a report replaces it rather than creating a second one; only the person who filed it, or an admin, can revise or delete it.

To browse everything already filed across every site — not just one — office staff use Reports (/admin/reports): a filterable, infinite-scroll feed of every daily and weekly report, distinct from the downloadable Business Reports export.`,
  },
  {
    key: 'snags_safety',
    title: 'Snags & safety',
    scope: 'site',
    description:
      'How to raise and resolve a defect (snag), and how to log a safety incident. NOT approving expense claims or material requests — see the relevant howto_ topic for those.',
    content: `A defect (snag) is raised with a title, location, severity (Low/Medium/High), an optional due date, and a required photo — tap the photo to pin exactly where the defect is. It moves Open → In progress (the supervisor starts work) → Resolved (marking it resolved requires a photo of the fix) → Verified. Only the office (Superadmin) can verify a fix or reopen one — a supervisor who resolved their own defect can't be the one who signs it off, so those controls simply don't appear for them; while waiting, they just see "waiting on the office to confirm the fix." Deleting is only available before a defect reaches Verified.

A safety incident is logged with when it happened, severity (Near miss / Minor / Serious), what happened, action taken, and an optional photo — there's no status or approval step, it's a straightforward log. Near misses are worth recording routinely, not just actual injuries — the pattern in near-misses is what the log is for.`,
  },
  {
    key: 'attendance_materials',
    title: 'Attendance & materials',
    scope: 'site',
    description:
      "How manual attendance entries and material requests work, and how stock movements are recorded. NOT how fingerprint devices are registered — that's Settings, see howto_settings.",
    content: `Attendance is device-first — fingerprint terminals sync automatically and nobody edits an hour by hand. When a device genuinely can't be used, a supervisor can only file a manual entry *request* (fundi, date, check-in/out, a reason) — the phone's location is captured and shown alongside it, and only the office decides to approve or reject it. That request/decide split — a supervisor requests, only an office user approves — is deliberate; a supervisor never sees labour cost figures or checks anyone out directly. A site's geofence (set by the office) shows whether a request was made from within or outside the site radius, but it's shown as a signal, not enforced — it never blocks approval by itself.

A material request names an existing stock item (or "+ Add new material" for something new), a quantity, and an optional needed-by date. It moves Pending → Approved (office) → Fulfilled ("Mark received", which also logs a real stock-in movement against on-hand quantities) or Rejected (with a reason). A supervisor can withdraw their own request while it's still Pending.

Stock itself (on-hand materials) is adjusted directly with "Received"/"Used" buttons per item, each requiring a reason — every movement is logged with who did it and when.`,
  },
  // ---- shared ----
  {
    key: 'submitting_expenses',
    title: 'Submitting an expense claim',
    scope: 'shared',
    description:
      "How a supervisor submits their own expense claim from site, versus how the office approves/pays one. Covers both halves of the same workflow — see howto_expenses_approval for more detail on the approval/payment side.",
    content: `A supervisor logs an expense from their site's Expenses tab: category, amount, description, date, and optionally a receipt photo — a "Scan receipt" option, where available, reads a photographed receipt and fills the form in for you to check before saving, it never saves on its own. A supervisor sees only their own submitted claims and whether each was accepted or rejected (with the reason, if rejected) — not the site's full spend history or what's owed to any supplier, which stays office-only.

The office (Superadmin or Accountant) sees every claim on the site — or, for spend that isn't tied to any site at all, on Company Expenses — and approves, rejects or pays it; see "Approving expenses" for that side in full.`,
  },
  {
    key: 'using_assistant',
    title: 'Using this assistant',
    scope: 'shared',
    description:
      'What this assistant can and can\'t do, how to read its answers, and why it sometimes stops answering for the day. Ask this when a question is about the assistant itself, not about the app\'s other features.',
    content: `This assistant answers two kinds of questions: what's actually in the system right now (money, sites, workers, attendance — pulled live, never estimated or guessed), and how to use the system (this manual). It only ever answers from real figures or from this reviewed manual — if neither has what's asked, it says so rather than filling the gap with a guess.

Every answer that draws on live data shows a source link at the bottom — tap it to land on the actual page the figures came from, so nothing here has to be taken on faith. What it can see depends on who's asking: a supervisor is only shown their own sites, never company-wide money or other people's pay; the office sees everything; an Accountant sees money and tax across every site but not Sites, Team, Leads, Contracts or Equipment.

It shares one daily allowance with receipt-reading and report-drafting elsewhere in the app, and is deliberately the first of the three to stop once that runs low — so those two keep working even on a day the assistant has already used up its share. If it declines to answer, that's either the daily allowance being spent, or genuinely nothing in its reach that answers the question — not a fault to work around.`,
  },
];
