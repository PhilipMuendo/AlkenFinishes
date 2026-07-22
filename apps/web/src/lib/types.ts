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
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  notes: string | null;
  receiptUrl: string | null;
  submittedBy: { id: string; name: string };
  createdAt: string;
}

export interface PaymentsSummary {
  contractValue: number;
  totalPaid: number;
  pendingBalance: number;
  balanceDueDate: string | null;
  dueDateHealth: Health;
  deposit: Payment | null;
  installments: Payment[];
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

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  quantity: string;
  reason: string;
  date: string;
  user: { id: string; name: string };
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
