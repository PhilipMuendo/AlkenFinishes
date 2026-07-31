export type Role = 'SUPERADMIN' | 'SUPERVISOR';
export type BudgetCategory = 'MATERIALS' | 'LABOUR' | 'TRANSPORT' | 'OTHER';
export type Health = 'GREEN' | 'YELLOW' | 'RED' | 'NONE';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Project {
  id: string;
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

export interface Expense {
  id: string;
  category: BudgetCategory;
  amount: string;
  description: string;
  receiptUrl: string | null;
  expenseDate: string;
  submittedBy: { id: string; name: string };
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
  notes: string | null;
  photos: { id: string; fileUrl: string; caption: string | null }[];
}

export interface Worker {
  id: string;
  name: string;
  phone: string | null;
  trade: string;
  hourlyRate: string;
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
  labourCost: string | null;
  worker: { id: string; name: string; trade: string; hourlyRate: string };
  recordedBy: { id: string; name: string } | null;
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
}

export interface DailyReport {
  id: string;
  date: string;
  workCompleted: string;
  workersPresent: number;
  materialsUsed: string | null;
  challenges: string | null;
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
