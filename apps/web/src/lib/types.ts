export type Role = 'SUPERADMIN' | 'SUPERVISOR' | 'ACCOUNTANT';
export type BudgetCategory = 'MATERIALS' | 'LABOUR' | 'TRANSPORT' | 'OTHER';
export type Health = 'GREEN' | 'YELLOW' | 'RED' | 'NONE';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';

export type NotificationType =
  | 'SYNC_ISSUE'
  | 'BUDGET_OVER_THRESHOLD'
  | 'PAYMENT_OVERDUE'
  | 'INVOICE_OVERDUE'
  | 'CONTRACT_AWAITING_SIGNATURE';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  occurrences: number;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  readAt: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Project {
  id: string;
  /** Allocated from the project number series, e.g. PRJ-2026-0017. */
  code: string | null;
  name: string;
  clientName: string;
  location: string;
  contractValue: string;
  startDate: string;
  expectedCompletion: string;
  status: ProjectStatus;
  progressPct: number;
  balanceDueDate: string | null;
  supervisorId: string | null;
  supervisor: { id: string; name: string; email: string; phone?: string | null } | null;
  contract: { id: string; contractNo: string | null; status: ContractStatus } | null;
  geofenceLat: string | null;
  geofenceLng: string | null;
  geofenceRadiusM: number | null;
}

export interface CategoryFinancials {
  category: BudgetCategory;
  allocated: number;
  actual: number;
  remaining: number;
  consumedPct: number | null;
  health: Health;
}

export interface ProjectFinancials {
  projectId: string;
  contractValue: number;
  totalBudget: number;
  totalActual: number;
  totalRemaining: number;
  estimatedProfit: number;
  attendanceLabourCost: number;
  labourCostSource: 'ATTENDANCE' | 'EXPENSES' | 'BOTH';
  overallConsumedPct: number | null;
  overallHealth: Health;
  categories: CategoryFinancials[];
  thresholds: { yellowPct: number; redPct: number };
}

export interface ExpenseSeriesRow {
  month: string;
  MATERIALS: number;
  LABOUR: number;
  TRANSPORT: number;
  OTHER: number;
  total: number;
  cumulative: number;
}

export type ExpenseCategory =
  | 'MATERIALS'
  | 'LABOUR'
  | 'TRANSPORT'
  | 'EQUIPMENT_HIRE'
  | 'SUBCONTRACTOR'
  | 'SITE_OVERHEADS'
  | 'OTHER';
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Expense {
  id: string;
  category: BudgetCategory;
  expenseCategory: ExpenseCategory;
  /** GROSS: what the supplier's invoice says, including any VAT. */
  amount: number;
  description: string;
  receiptUrl: string | null;
  expenseDate: string;
  status: ExpenseStatus;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  rejectReason: string | null;
  submittedBy: { id: string; name: string };
  createdAt: string;

  // Payables. Everything below is null/empty on a cost with no supplier —
  // petty cash and fuel are not debts and carry no balance.
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  supplierInvoiceNo: string | null;
  dueDate: string | null;
  vatAmount: number;
  taxInvoice: boolean;
  payments: SupplierPayment[];
  position: PayablePosition | null;
}

export type PaymentMethodValue =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'MPESA'
  | 'CHEQUE'
  | 'OTHER';

export interface SupplierPayment {
  id: string;
  /** Cash the supplier actually received. */
  amount: number;
  method: PaymentMethodValue;
  paymentDate: string;
  referenceNo: string | null;
  notes: string | null;
  proofUrl: string | null;
  /** Tax deducted from this payment and owed to KRA instead of the supplier. */
  whtAmount: number;
  whtVatAmount: number;
  whtCertNo: string | null;
  whtRemittedAt: string | null;
  paidBy: { id: string; name: string };
  createdAt: string;
}

/** What is owed on one supplier bill. Derived, never stored. */
export interface PayablePosition {
  amount: number;
  vatAmount: number;
  netAmount: number;
  reclaimableVat: number;
  cashPaid: number;
  taxWithheld: number;
  /** cashPaid + taxWithheld: what has settled the bill. */
  paid: number;
  outstanding: number;
  overpaid: number;
  paidPct: number;
  settled: boolean;
  overdue: boolean;
  daysOverdue: number;
  agingBucket: AgingBucket;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  position: SupplierRollup | null;
}

/** A supplier's totals across every bill. */
export interface SupplierRollup {
  supplierId: string;
  openBills: number;
  billed: number;
  paid: number;
  cashPaid: number;
  taxWithheld: number;
  reclaimableVat: number;
  outstanding: number;
  overpaid: number;
  overdue: number;
  oldestOverdueDays: number | null;
  aging: Record<AgingBucket, number>;
}

/** GET /suppliers/payables */
export interface PayablesReport {
  summary: {
    billed: number;
    paid: number;
    cashPaid: number;
    taxWithheld: number;
    reclaimableVat: number;
    outstanding: number;
    overpaid: number;
    overdue: number;
    supplierCount: number;
    openBills: number;
    oldestOverdueDays: number | null;
    aging: Record<AgingBucket, number>;
  };
  suppliers: (SupplierRollup & { name: string; phone: string | null })[];
}

/** GET /tax/position */
export interface TaxPosition {
  period: { from: string; to: string };
  vat: {
    outputVat: number;
    inputVatCharged: number;
    inputVatReclaimable: number;
    /** Input VAT with no supplier tax invoice behind it: a cost, not a credit. */
    inputVatUnsupported: number;
    /** Positive means payable to KRA; negative is a credit carried forward. */
    netVatPayable: number;
    invoiceCount: number;
    billCount: number;
  };
  withholding: {
    withheldFromSuppliers: number;
    notYetRemitted: number;
    /** Withheld from casual/contracted staff (not on Payroll) and owed to KRA. */
    withheldFromStaff: number;
    staffNotYetRemitted: number;
    withheldByClients: number;
    certificatesOutstanding: number;
    certificatesOutstandingCount: number;
  };
}

/** GET /tax/certificates-outstanding */
export interface OutstandingCertificate {
  id: string;
  receiptNo: string | null;
  paymentDate: string;
  withheld: number;
  project: { id: string; name: string; clientName: string };
  invoice: { id: string; invoiceNo: string | null } | null;
  daysWaiting: number;
}

/** GET /settings/purchase-tax */
export interface PurchaseTaxConfig {
  vatRatePct: number;
  billsIncludeVat: boolean;
  defaultWhtRatePct: number;
  defaultWhtVatRatePct: number;
  withholdingAgent: boolean;
  /** Whether the server has receipt reading configured. Not a user setting. */
  receiptScanning?: boolean;
}

/** GET/PUT /settings/staff-tax. Its own rate — not shared with purchase tax. */
export interface StaffTaxConfig {
  withholdingAgent: boolean;
  defaultWhtRatePct: number;
}

/** Why a scan failed, when the form needs to do more than show the message. */
export type ScanFailure =
  | 'NOT_CONFIGURED'
  | 'RATE_LIMIT'
  | 'QUOTA_DAILY'
  | 'AUTH'
  | 'MODEL_UNAVAILABLE'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'UNREADABLE'
  | 'UPSTREAM';

/** One deterministic check run against what was read off a receipt. */
export interface ReceiptCheck {
  id: string;
  status: 'OK' | 'WARN' | 'UNKNOWN';
  message: string;
}

/** POST /projects/:id/expenses/scan-receipt — a draft, never a saved record. */
export interface ScannedReceipt {
  extracted: {
    supplierName: string | null;
    supplierPin: string | null;
    invoiceNo: string | null;
    date: string | null;
    subtotal: number | null;
    vatAmount: number | null;
    total: number | null;
    taxInvoice: boolean;
    note: string | null;
  };
  checks: ReceiptCheck[];
  needsReview: boolean;
  suggested: { amount: number | null; vatAmount: number | null; vatRatePct: number | null };
  supplier: { id: string; name: string } | null;
  /** A name was read but is not on the supplier list. */
  supplierUnmatched: boolean;
}

/** What is owed to one worker, from attendance. Derived, never stored. */
export interface WorkerPosition {
  accrued: number;
  cashPaid: number;
  taxWithheld: number;
  paid: number;
  outstanding: number;
  overpaid: number;
  paidPct: number;
  settled: boolean;
}

export interface WorkerPayment {
  id: string;
  /** Cash the worker actually received. */
  amount: number;
  method: PaymentMethodValue;
  paymentDate: string;
  referenceNo: string | null;
  notes: string | null;
  proofUrl: string | null;
  /** Tax deducted from this payment and owed to KRA instead of the worker. */
  whtAmount: number;
  whtCertNo: string | null;
  whtRemittedAt: string | null;
  paidBy: { id: string; name: string };
  createdAt: string;
}

/** GET /workers/:id/payment-suggestion */
export interface WorkerPaymentSuggestion {
  position: WorkerPosition;
  tax: StaffTaxConfig;
  suggested: { amount: number; whtAmount: number };
  payments: WorkerPayment[];
}

/** GET /workers/payables */
export interface WorkerPayablesReport {
  summary: {
    accrued: number;
    paid: number;
    cashPaid: number;
    taxWithheld: number;
    outstanding: number;
    overpaid: number;
    workerCount: number;
  };
  workers: (WorkerPosition & { worker: { id: string; name: string; trade: string } })[];
}

/** GET /projects/:id/expenses/:expenseId/payment-suggestion */
export interface PaymentSuggestion {
  position: PayablePosition;
  tax: PurchaseTaxConfig;
  outstandingNet: number;
  suggested: { amount: number; whtAmount: number; whtVatAmount: number };
}

export type MaterialRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED';

export interface MaterialRequest {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  neededBy: string | null;
  notes: string | null;
  status: MaterialRequestStatus;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  rejectReason: string | null;
  fulfilledAt: string | null;
  createdAt: string;
}

export type PaymentType = 'DEPOSIT' | 'INSTALLMENT';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MPESA' | 'CHEQUE' | 'OTHER';

export interface Payment {
  id: string;
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  notes: string | null;
  /** The CLIENT's uploaded proof of payment (bank slip, M-Pesa screenshot). */
  receiptUrl: string | null;
  submittedBy: { id: string; name: string };
  createdAt: string;
  invoiceId: string | null;
  invoice: { id: string; invoiceNo: string | null; type: InvoiceType } | null;
  bankName: string | null;
  referenceNo: string | null;
  /** OUR official numbered receipt. A different document from receiptUrl. */
  receiptNo: string | null;
  receiptPdfUrl: string | null;
  voidedAt: string | null;
  voidReason: string | null;

  /** Tax the client deducted and remitted to KRA on our behalf. */
  whtAmount: number;
  whtVatAmount: number;
  whtCertNo: string | null;
  whtCertReceivedAt: string | null;
  /** amount + withheld: what this receipt actually took off the invoice. */
  settled: number;
}

export interface PaymentsSummary {
  contractValue: number;
  totalPaid: number;
  /** Balance on contract: contractValue − payments. NOT the same as arOutstanding. */
  pendingBalance: number;
  balanceDueDate: string | null;
  dueDateHealth: Health;
  /** Billed but not yet paid. Differs from pendingBalance by un-invoiced work. */
  invoicedNet: number;
  arOutstanding: number;
  arOverdue: number;
  retentionHeld: number;
  onAccount: number;
  deposit: Payment | null;
  installments: Payment[];
}

export type InvoiceType =
  | 'MOBILISATION'
  | 'PROGRESS_CLAIM'
  | 'VARIATION'
  | 'FINAL_ACCOUNT'
  | 'RETENTION';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export interface InvoiceLine {
  id: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  taxable: boolean;
  /** Set on progress-claim lines: the schedule item this line claims against. */
  sourceLineId?: string | null;
  /** Set on progress-claim lines: completeness of that item to date, 0–100. */
  cumulativePct?: number | null;
}

/** One item of the priced schedule, with what it is worth and what is left. */
export interface ClaimPosition {
  line: {
    id: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
    taxable: boolean;
    sortOrder: number;
  };
  previouslyClaimed: number;
  previouslyClaimedPct: number;
  remaining: number;
}

/** GET /projects/:id/invoices/claim-schedule */
export interface ClaimSchedule {
  contract: { id: string; contractNo: string; title: string | null } | null;
  hasSchedule: boolean;
  contractValue: number;
  claimedToDate: number;
  remainingToClaim: number;
  positions: ClaimPosition[];
}

export interface Invoice {
  id: string;
  projectId: string;
  invoiceNo: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  title: string | null;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientAddress: string | null;
  clientKraPin: string | null;
  vatRatePct: number;
  retentionRatePct: number;
  vatInclusive: boolean;
  subtotal: number;
  vatAmount: number;
  grossTotal: number;
  retentionAmount: number;
  netPayable: number;
  notes: string | null;
  pdfUrl: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: InvoiceLine[];
  amountPaid: number;
  balance: number;
  overdue: boolean;
  daysOverdue: number;
  agingBucket: AgingBucket;
  payments?: Payment[];
}

/** One project's receivables position, from GET /invoices/summary. */
export interface ProjectReceivables {
  contractValue: number;
  invoicedNet: number;
  invoicedGross: number;
  retentionHeld: number;
  receiptedAgainstInvoices: number;
  onAccount: number;
  totalCollected: number;
  arOutstanding: number;
  arOverdue: number;
  oldestOverdueDays: number | null;
  counts: { draft: number; issued: number; partiallyPaid: number; paid: number; overdue: number };
}

/** A row in the cross-project A/R register. */
export interface InvoiceRegisterRow {
  id: string;
  invoiceNo: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  title: string | null;
  project: { id: string; name: string };
  clientName: string;
  issueDate: string;
  dueDate: string;
  netPayable: number;
  amountPaid: number;
  balance: number;
  overdue: boolean;
  daysOverdue: number;
  agingBucket: AgingBucket;
}

export interface CompanyReceivables {
  totalAr: number;
  totalOverdue: number;
  retentionHeld: number;
  buckets: Record<AgingBucket, number>;
}

export interface CompanyProfile {
  name: string;
  addressLines: string[];
  phone: string;
  email: string;
  kraPin: string;
  vatRegistered: boolean;
  bank: {
    name: string;
    branch: string;
    accountName: string;
    accountNo: string;
    swift: string;
    mpesaPaybill: string;
  };
  logoUrl: string | null;
}

export interface InvoicingConfig {
  invoicePrefix: string;
  receiptPrefix: string;
  numberPadding: number;
  vatRatePct: number;
  defaultRetentionPct: number;
  defaultPaymentTermsDays: number;
  footerNote: string;
  nextInvoiceNo?: string;
  nextReceiptNo?: string;
}

export interface Tool {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: string;
  currentProject: { id: string; name: string } | null;
  status: ToolStatus;
  conditionNotes: string | null;
  nextServiceDate: string | null;
  createdAt: string;
}

export interface ToolTransfer {
  id: string;
  quantity: string;
  transferDate: string;
  proofPhotoUrl: string;
  notes: string | null;
  fromProject: { id: string; name: string } | null;
  toProject: { id: string; name: string };
  transferredBy: { id: string; name: string };
  createdAt: string;
}

export interface Task {
  id: string;
  phase: string;
  name: string;
  status: TaskStatus;
  completionPct: number;
  /** Relative size of this task. 1 is the default — i.e. "not yet weighted". */
  weight: number;
  notes: string | null;
  photos: { id: string; fileUrl: string; caption: string | null }[];
}

/** Server-computed weighting summary — never recalculated in the browser. */
export interface TaskProgress {
  pct: number;
  unweightedPct: number;
  weighted: boolean;
  totalWeight: number;
  taskCount: number;
  unweightedTaskCount: number;
}

export interface TasksResponse {
  tasks: Task[];
  progress: TaskProgress;
}

export interface Worker {
  id: string;
  name: string;
  phone: string | null;
  trade: string;
  /** Office only — the server omits it for supervisors. */
  hourlyRate?: string;
  status: 'ACTIVE' | 'INACTIVE';
  biometricId: string | null;
  assignments: { id: string; project: { id: string; name: string } }[];
}

export interface AttendanceRecord {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string | null;
  deviceId: string | null;
  method: 'FINGERPRINT' | 'MANUAL_OVERRIDE';
  hoursWorked: string | null;
  /** Office only — the server omits it for supervisors. */
  labourCost?: string | null;
  worker: { id: string; name: string; trade: string; hourlyRate?: string };
  recordedBy: { id: string; name: string } | null;
}

export type OverrideRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AttendanceOverrideRequest {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string | null;
  reason: string;
  latitude: string | null;
  longitude: string | null;
  withinGeofence: boolean | null;
  status: OverrideRequestStatus;
  worker: { id: string; name: string; trade: string };
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  quantity: string;
  reason: string;
  date: string;
  user: { id: string; name: string };
}

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  updatedAt: string;
  movements?: StockMovement[]; // most recent movement only, from the list endpoint
}

export interface ProjectDocument {
  id: string;
  type: string;
  name: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  /** Rendered by the system (an invoice/receipt PDF) rather than uploaded — cannot be deleted from here. */
  systemGenerated: boolean;
}

export interface DailyReport {
  id: string;
  date: string;
  workCompleted: string;
  workersPresent: number;
  materialsUsed: string | null;
  challenges: string | null;
  weather: string | null;
  visitors: string | null;
  materialsDelivered: string | null;
  instructionsGiven: string | null;
  delays: string | null;
  safetyNotes: string | null;
  equipmentOnSite: string | null;
  photoUrls: string[];
  submittedBy: { id: string; name: string };
}

export interface WeeklyReport {
  id: string;
  weekEnding: string;
  summary: string;
  milestones: string | null;
  issues: string | null;
  nextWeekPlan: string | null;
  photoUrls: string[];
  submittedBy: { id: string; name: string };
  createdAt: string;
  /** Later than `createdAt` when the week's report was filed again and revised. */
  updatedAt: string;
}

// Unified cross-site feed item from GET /reports (super admin).
export interface ReportFeedItem {
  id: string;
  type: 'DAILY' | 'WEEKLY';
  date: string;
  project: { id: string; name: string };
  submittedBy: { name: string };
  // daily
  workCompleted?: string;
  workersPresent?: number;
  materialsUsed?: string | null;
  challenges?: string | null;
  // weekly
  summary?: string;
  milestones?: string | null;
  issues?: string | null;
  nextWeekPlan?: string | null;
  photoUrls: string[];
}

export interface CompanyAnalytics {
  totals: {
    contractValue: number;
    totalActual: number;
    estimatedProfit: number;
    totalBudget: number;
    totalCollected: number;
    totalPendingBalance: number;
    overallHealth: Health;
  };
  projects: {
    id: string;
    name: string;
    clientName: string;
    location: string;
    startDate: string;
    expectedCompletion: string;
    status: ProjectStatus;
    progressPct: number;
    supervisorId: string | null;
    supervisor: { id: string; name: string } | null;
    contractValue: number;
    totalBudget: number;
    totalActual: number;
    estimatedProfit: number;
    consumedPct: number | null;
    health: Health;
    manualOverrides30d: number;
    totalCollected: number;
    pendingBalance: number;
  }[];
  spendTrend: { month: string; total: number }[];
}

// Overview digest — only the projects that need the owner's attention.
export interface AttentionDigest {
  activeCount: number;
  portfolioCount: number;
  allClear: boolean;
  groups: {
    paymentOverdue: {
      id: string;
      name: string;
      pendingBalance: number;
      balanceDueDate: string;
      daysOverdue: number;
    }[];
    overBudget: { id: string; name: string; consumedPct: number | null }[];
    unassigned: { id: string; name: string }[];
    wentQuiet: { id: string; name: string; lastReportAt: string | null; daysSince: number | null }[];
    finishingSoon: { id: string; name: string; expectedCompletion: string; daysLeft: number }[];
    pendingApprovals: {
      id: string;
      name: string;
      expenses: number;
      materialRequests: number;
      attendanceOverrides: number;
      total: number;
    }[];
  };
}

export interface ProjectAnalytics {
  project: {
    id: string;
    name: string;
    status: ProjectStatus;
    progressPct: number;
    supervisor: { id: string; name: string } | null;
  };
  financials: ProjectFinancials;
  expenseSeries: ExpenseSeriesRow[];
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  active: boolean;
  projects: { id: string; name: string }[];
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  user: { id: string; name: string; role: Role } | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  page: number;
  hasMore: boolean;
}

// ---- Pre-project pipeline: Lead -> Quotation -> Contract -> Project ----

export type LeadStage = 'NEW' | 'CONTACTED' | 'SITE_VISIT' | 'QUOTED' | 'WON' | 'LOST';
export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type ContractStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'SIGNED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'TERMINATED';
export type VariationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Client {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  kraPin: string | null;
  notes: string | null;
  createdAt: string;
  _count: { leads: number; quotations: number; contracts: number; projects: number };
  totalContractValue: number;
}

export interface Lead {
  id: string;
  clientId: string;
  client: { id: string; name: string; phone: string | null; email: string | null };
  title: string;
  description: string | null;
  estimatedValue: number | null;
  stage: LeadStage;
  source: string | null;
  expectedCloseDate: string | null;
  lostReason: string | null;
  owner: { id: string; name: string } | null;
  createdAt: string;
  quotations: { id: string; quotationNo: string | null; status: QuotationStatus; total: number }[];
}

export interface LeadPipeline {
  open: number;
  openValue: number;
  byStage: Record<string, { count: number; value: number }>;
}

export interface QuotationLine {
  id: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  taxable: boolean;
}

export interface Quotation {
  id: string;
  quotationNo: string | null;
  clientId: string;
  client: { id: string; name: string; phone: string | null; email: string | null };
  leadId: string | null;
  lead: { id: string; title: string; stage: LeadStage } | null;
  title: string;
  status: QuotationStatus;
  issueDate: string;
  validUntil: string;
  clientNameSnapshot: string;
  vatRatePct: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  termsText: string | null;
  notes: string | null;
  pdfUrl: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  preparedBy: { id: string; name: string };
  lines: QuotationLine[];
  contract: { id: string; contractNo: string | null; status: ContractStatus } | null;
  /** Derived on read: SENT and past its validity date. */
  expired: boolean;
}

export interface Variation {
  id: string;
  reference: string;
  description: string;
  amount: number;
  status: VariationStatus;
  requestedDate: string;
  approvedDate: string | null;
  approvedBy: { id: string; name: string } | null;
  rejectReason: string | null;
  documentUrl: string | null;
}

/**
 * All ex-VAT except grossValue — matching the contract itself, where the
 * Contract Sum is stated exclusive of VAT and retention is calculated on it.
 */
export interface ContractPosition {
  originalValue: number;
  approvedVariations: number;
  pendingVariations: number;
  currentValue: number;
  vatRatePct: number;
  vatAmount: number;
  grossValue: number;
  retentionPct: number;
  retentionAmount: number;
  defectsLiabilityMonths: number;
  defectsLiabilityEnds: string | null;
}

export interface Contract {
  id: string;
  contractNo: string | null;
  clientId: string;
  client: Client;
  quotationId: string | null;
  quotation: {
    id: string;
    quotationNo: string | null;
    title: string;
    issueDate: string;
    total: number;
  } | null;
  projectId: string | null;
  project: {
    id: string;
    code: string | null;
    name: string;
    status: ProjectStatus;
    progressPct: number;
  } | null;
  title: string;
  status: ContractStatus;
  originalValue: number;
  vatRatePct: number;
  retentionPct: number;
  defectsLiabilityMonths: number;
  startDate: string;
  expectedCompletion: string;
  signedDate: string | null;
  practicalCompletionDate: string | null;
  generatedPdfUrl: string | null;
  signedPdfUrl: string | null;
  boqUrl: string | null;
  specsUrl: string | null;
  notes: string | null;
  variations: Variation[];
  position: ContractPosition;
}

/** The pre-project pipeline, aggregated for the overview. */
export interface PipelineDigest {
  openLeads: { count: number; value: number };
  leadsByStage: Record<string, { count: number; value: number }>;
  quotationsAwaitingDecision: { count: number; value: number };
  contractsAwaitingSignature: { count: number; value: number };
  contractsWithoutSite: { count: number; value: number };
}

export interface PipelineConfig {
  quotationPrefix: string;
  contractPrefix: string;
  projectPrefix: string;
  quotationValidityDays: number;
  quotationTermsText: string;
  contractTermsText: string;
  nextQuotationNo: string;
  nextContractNo: string;
  nextProjectCode: string;
}

export type SnagSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type SnagStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED';

export interface SnagItem {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  severity: SnagSeverity;
  status: SnagStatus;
  photoUrl: string | null;
  annotation: { x: number; y: number } | null;
  dueDate: string | null;
  resolvedPhotoUrl: string | null;
  resolvedAt: string | null;
  verifiedAt: string | null;
  assignedTo: { id: string; name: string } | null;
  reportedBy: { id: string; name: string };
  lastActionBy: { id: string; name: string } | null;
  createdAt: string;
}

export type SafetyIncidentSeverity = 'NEAR_MISS' | 'MINOR' | 'SERIOUS';

export interface SafetyIncident {
  id: string;
  occurredAt: string;
  severity: SafetyIncidentSeverity;
  description: string;
  actionTaken: string | null;
  photoUrl: string | null;
  reportedBy: { id: string; name: string };
  createdAt: string;
}

export type ToolStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

/** Types someone books, and can therefore create. */
export type CalendarEventType =
  | 'MILESTONE'
  | 'INSPECTION'
  | 'DELIVERY'
  | 'MEETING'
  | 'SITE_VISIT'
  | 'CLIENT_APPOINTMENT'
  | 'OTHER';

/**
 * Types the server computes from records that already exist. They have no row
 * behind them, so they cannot be edited or deleted from the calendar.
 */
export type DerivedEventType =
  | 'PROJECT_DEADLINE'
  | 'PAYROLL'
  | 'EQUIPMENT_SERVICE'
  | 'BIRTHDAY'
  | 'RETENTION_DUE'
  | 'WARRANTY_EXPIRY';

export type AnyCalendarEventType = CalendarEventType | DerivedEventType;

export interface CalendarEvent {
  id: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  title: string;
  type: AnyCalendarEventType;
  date: string;
  notes: string | null;
  /** True for server-computed entries; they have no createdBy. */
  derived: boolean;
  createdBy?: { id: string; name: string };
  createdAt?: string;
}

export type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'GOOD';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  message: string;
  action?: string;
  financial?: boolean;
}

export interface CommandCentreProgramme {
  actualPct: number;
  /** False when every task counted equally — the projection is rougher. */
  weighted: boolean;
  unweightedTaskCount: number;
  taskCount: number;
  /** Null until enough of the programme has elapsed to extrapolate from. */
  plannedPct: number | null;
  slipDays: number | null;
  projectedFinish: string | null;
  startDate: string;
  expectedCompletion: string;
  daysRemaining: number;
}

export interface CommandCentreAttendance {
  assignedWorkers: number;
  checkedInToday: number;
  late: number;
  /** Null when there is no roster to compare against. */
  absent: number | null;
  stillOpen: number;
  firstCheckIn: string | null;
  lastCheckOut: string | null;
  dayStart: string;
}

export interface CommandCentreEquipmentItem {
  id: string;
  name: string;
  category: string | null;
  status: ToolStatus;
  nextServiceDate: string | null;
  serviceOverdue: boolean;
}

export interface CommandCentrePhoto {
  id: string;
  url: string;
  takenAt: string;
  caption: string | null;
}

/**
 * Money sections are null for a supervisor — the server omits them rather than
 * zeroing them, so `canSeeMoney` is what the UI branches on, never a 0.
 */
export interface CommandCentreData {
  project: { id: string; name: string; status: ProjectStatus };
  canSeeMoney: boolean;

  programme: CommandCentreProgramme;
  attendance: CommandCentreAttendance;
  snags: { open: number; bySeverity: Record<string, number>; overdue: number; rework: number };
  equipment: {
    total: number;
    active: number;
    down: number;
    serviceOverdue: number;
    items: CommandCentreEquipmentItem[];
  };
  safety: {
    windowDays: number;
    total: number;
    bySeverity: Record<'SERIOUS' | 'MINOR' | 'NEAR_MISS', number>;
    recent: { id: string; severity: SafetyIncidentSeverity; description: string; occurredAt: string }[];
  };
  photos: CommandCentrePhoto[];
  insights: Insight[];
  pendingApprovals: { expenses: number; materialRequests: number; attendanceOverrides: number };
  upcomingEvents: CalendarEvent[];
  latestDailyReport: { date: string; workersPresent: number } | null;
  daysSinceLastReport: number | null;

  financials: ProjectFinancials | null;
  contractPosition: ContractPosition | null;
  /** Null for a supervisor. False means the site was raised outside the
   *  commercial chain, so claims and retention cannot work yet. */
  contractLinked: boolean | null;
  materials: {
    allocated: number;
    actual: number;
    remaining: number;
    consumedPct: number | null;
    health: Health;
  } | null;
  profit: {
    revenueEarned: number;
    totalCost: number;
    grossProfit: number;
    marginPct: number | null;
    estimatedProfit: number;
  } | null;
  invoices: {
    invoiced: number;
    collected: number;
    outstanding: number;
    overdue: number;
    overdueCount: number;
    oldestOverdueDays: number | null;
    retentionHeld: number;
  } | null;
}

// ---- Payroll ----

export interface PayeBand {
  /** Upper bound of this band. Null means "and above". */
  upTo: number | null;
  ratePct: number;
}

export interface NssfTier {
  upTo: number | null;
  employeePct: number;
  employerPct: number;
}

/** GET /settings/payroll. Every figure is the user's to set. */
export interface PayrollConfig {
  enabled: boolean;
  payeBands: PayeBand[];
  /** Subtracted from the TAX due, never from pay. */
  personalReliefPerMonth: number;
  nssfTiers: NssfTier[];
  shifRatePct: number;
  shifMinimum: number;
  housingLevyEmployeePct: number;
  housingLevyEmployerPct: number;
}

export interface PayrollLine {
  workerId: string;
  workerName: string;
  trade: string;
  hoursWorked: number;
  gross: number;
  nssf: number;
  paye: number;
  shif: number;
  housingLevy: number;
  totalDeductions: number;
  netPay: number;
  employerNssf: number;
  employerHousingLevy: number;
}

export interface PayrollTotals {
  gross: number;
  paye: number;
  nssfEmployee: number;
  nssfEmployer: number;
  shif: number;
  housingLevyEmployee: number;
  housingLevyEmployer: number;
  totalDeductions: number;
  netPay: number;
  /** Gross plus employer contributions: what the labour actually costs. */
  employerCost: number;
  remittances: { paye: number; nssf: number; shif: number; housingLevy: number };
}

/** POST /payroll/preview */
export interface PayrollPreview {
  config: PayrollConfig;
  /** Preview lines carry `rateMissing`; stored run lines do not. */
  lines: (PayrollLine & { rateMissing?: boolean })[];
  totals: PayrollTotals;
}

export type PayrollRunStatus = 'DRAFT' | 'FINALISED';

export interface PayrollRunSummary {
  id: string;
  periodFrom: string;
  periodTo: string;
  status: PayrollRunStatus;
  notes: string | null;
  project: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  finalisedAt: string | null;
  workerCount: number;
  totals: PayrollTotals;
}

export interface PayrollRunDetail extends Omit<PayrollRunSummary, 'workerCount'> {
  lines: PayrollLine[];
  /** The rates in force when the run was made, not today's. */
  config: PayrollConfig;
}


/** POST /projects/:id/daily-reports/draft — prose only; counts come from the data. */
export interface DailyReportDraft {
  draft: {
    workCompleted: string;
    materialsUsed: string | null;
    challenges: string | null;
    safetyNotes: string | null;
  };
  /** Counted from attendance, never drafted. */
  workersPresent: number;
  /** The facts the draft was built from, shown so it can be checked. */
  facts: string;
}

/** POST /projects/:id/weekly-reports/draft — summarised from the week's own daily reports. */
export interface WeeklyReportDraft {
  draft: {
    summary: string;
    milestones: string | null;
    issues: string | null;
    nextWeekPlan: string | null;
  };
  /** How many of the week's 7 days had a diary entry filed. */
  daysReported: number;
  /** The facts (the week's daily reports) the draft was built from, shown so it can be checked. */
  facts: string;
}

/** GET /chat/status — whether the assistant exists and can answer right now. */
export interface ChatStatus {
  available: boolean;
  canAsk: boolean;
  remaining?: number;
  reason?: 'NOT_CONFIGURED' | 'BUDGET_SPENT' | 'RESERVED_FOR_WORK';
  message?: string;
}

/** POST /chat/ask — an answer, with the facts it was written from. */
export interface ChatAnswer {
  answer: string;
  /** Which lookups ran. */
  used: string[];
  /** The retrieved facts, shown so the answer can be checked rather than trusted. */
  facts: string;
  sources: { label: string; href: string }[];
}

/** GET /settings/ai — the assistant's share of the daily allowance, and today's usage. */
export interface AiSettings {
  available: boolean;
  provider: 'gemini' | 'anthropic' | null;
  budget: { dailyCalls: number; reservedForWork: number };
  usage: { day: string; chat: number; receipt: number; report: number };
  used: number;
  chat: { allowed: boolean; remaining: number; remainingOverall: number; reason?: string };
}
