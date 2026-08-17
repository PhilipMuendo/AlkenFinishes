/**
 * Every React Query key in the app.
 *
 * Shape is `[domain, ...scope]`, domain always the plural kebab-case name of
 * the thing. Each domain exposes `all()` — the prefix that invalidates
 * everything under it — alongside the specific keys. Before this file the keys
 * had drifted into four different shapes (`['settings','invoicing']` beside
 * `['finance-settings']`; `['invoice']` beside `['invoices']`), so some
 * invalidations silently matched nothing.
 *
 * Lists that take parameters carry a `'list'` segment and single records carry
 * `'detail'`, so a status filter can never collide with a record id.
 *
 * Add keys here rather than inline — a literal at a call site is exactly how
 * the drift started.
 */

/** Filters for the cross-project invoice register. */
export interface InvoiceRegisterFilters {
  projectId: string;
  status: string;
  /** '' for all, 'true' for overdue only — mirrors the query string. */
  overdue: string;
}

/** Filters for the report feed. */
export interface ReportFeedFilters {
  projectId: string;
  type: string;
  from: string;
  to: string;
}

export const queryKeys = {
  // ---- Projects ---------------------------------------------------------
  projects: {
    all: () => ['projects'] as const,
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  },

  // ---- People -----------------------------------------------------------
  users: {
    all: () => ['users'] as const,
  },
  workers: {
    all: () => ['workers'] as const,
    byProject: (projectId: string) => ['workers', 'by-project', projectId] as const,
  },

  // ---- Winning work -----------------------------------------------------
  clients: {
    all: () => ['clients'] as const,
    list: (search = '') => ['clients', 'list', search] as const,
  },
  leads: {
    all: () => ['leads'] as const,
  },
  quotations: {
    all: () => ['quotations'] as const,
    list: (status = '') => ['quotations', 'list', status] as const,
  },
  contracts: {
    all: () => ['contracts'] as const,
    list: (status = '') => ['contracts', 'list', status] as const,
    // Nullable: the detail query is `enabled` only once a row is opened.
    detail: (contractId: string | null) => ['contracts', 'detail', contractId] as const,
  },

  // ---- Money ------------------------------------------------------------
  invoices: {
    all: () => ['invoices'] as const,
    byProject: (projectId: string) => ['invoices', 'by-project', projectId] as const,
    detail: (invoiceId: string) => ['invoices', 'detail', invoiceId] as const,
    summary: (projectId: string) => ['invoices', 'summary', projectId] as const,
    receivables: () => ['invoices', 'receivables'] as const,
    register: (filters: InvoiceRegisterFilters) => ['invoices', 'register', filters] as const,
  },
  payments: {
    all: () => ['payments'] as const,
    summary: (projectId: string) => ['payments', 'summary', projectId] as const,
  },
  budget: {
    byProject: (projectId: string) => ['budget', projectId] as const,
  },
  expenses: {
    byProject: (projectId: string) => ['expenses', projectId] as const,
    mine: (projectId: string) => ['expenses', projectId, 'mine'] as const,
  },

  // ---- On site ----------------------------------------------------------
  tasks: {
    byProject: (projectId: string) => ['tasks', projectId] as const,
  },
  attendance: {
    byProject: (projectId: string) => ['attendance', projectId] as const,
    overrideRequests: (projectId: string) => ['attendance-override-requests', projectId] as const,
  },
  stock: {
    byProject: (projectId: string) => ['stock', projectId] as const,
    history: (itemId: string | undefined) => ['stock', 'history', itemId] as const,
  },
  documents: {
    byProject: (projectId: string) => ['documents', projectId] as const,
    filtered: (projectId: string, filter: string) => ['documents', projectId, filter] as const,
  },
  dailyReports: {
    byProject: (projectId: string) => ['daily-reports', projectId] as const,
  },
  weeklyReports: {
    byProject: (projectId: string) => ['weekly-reports', projectId] as const,
  },
  snags: {
    byProject: (projectId: string) => ['snags', projectId] as const,
    filtered: (projectId: string, status: string) => ['snags', projectId, status] as const,
  },
  safetyIncidents: {
    byProject: (projectId: string) => ['safety-incidents', projectId] as const,
  },
  materialRequests: {
    byProject: (projectId: string) => ['material-requests', projectId] as const,
  },
  commandCentre: {
    byProject: (projectId: string) => ['command-centre', projectId] as const,
  },
  calendar: {
    all: () => ['calendar'] as const,
    byProject: (projectId: string) => ['calendar', projectId] as const,
  },
  tools: {
    all: () => ['tools'] as const,
    transfers: (toolId: string | undefined) => ['tools', 'transfers', toolId] as const,
  },
  reports: {
    feed: (filters: ReportFeedFilters) => ['reports', 'feed', filters] as const,
  },

  // ---- Analytics --------------------------------------------------------
  analytics: {
    all: () => ['analytics'] as const,
    company: () => ['analytics', 'company'] as const,
    project: (projectId: string) => ['analytics', 'project', projectId] as const,
    attention: () => ['analytics', 'attention'] as const,
    pipeline: () => ['analytics', 'pipeline'] as const,
  },

  // ---- Settings ---------------------------------------------------------
  // All under one namespace, so `invalidateQueries(queryKeys.settings.all())`
  // genuinely means "every setting" — it did not before.
  settings: {
    all: () => ['settings'] as const,
    company: () => ['settings', 'company'] as const,
    finance: () => ['settings', 'finance'] as const,
    invoicing: () => ['settings', 'invoicing'] as const,
    pipeline: () => ['settings', 'pipeline'] as const,
    quotationDefaults: () => ['settings', 'quotation-defaults'] as const,
    auditLog: (page: number) => ['settings', 'audit-log', page] as const,
  },

  // ---- Attendance devices ----------------------------------------------
  devices: {
    all: () => ['devices'] as const,
    syncIssues: () => ['devices', 'sync-issues'] as const,
  },
} as const;
