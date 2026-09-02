import { PageHeader } from '@/components/ui/page-header';
import { ExpensesPanel } from '@/features/ExpensesPanel';

/**
 * Spend that isn't tied to any site — uniforms for the fundis, office
 * supplies, tools bought ahead of a future contract. Same approval, VAT and
 * supplier-payment workflow as a site's Expenses tab (ExpensesPanel handles
 * both), just with no project to file it under.
 */
export function CompanyExpensesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Expenses"
        description="Spend that isn't tied to any site — uniforms, office supplies, and the like"
      />
      <ExpensesPanel emptyLabel="No company expenses recorded yet" />
    </div>
  );
}
