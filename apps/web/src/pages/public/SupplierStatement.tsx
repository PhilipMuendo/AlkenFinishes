import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fmtDate, fmtMoney } from '@/lib/format';

/**
 * A supplier checking their own balance with no login of their own. Same
 * bare-`fetch` reasoning as `SignContract.tsx`/`DecideQuotation.tsx` — no
 * session exists on this page for the authenticated `api()` client to use.
 * Read-only: there is nothing here to submit.
 */

class PublicApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function publicApi<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1/statement${path}`);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublicApiError(res.status, payload.error ?? 'Something went wrong');
  return payload as T;
}

interface StatementBill {
  id: string;
  description: string;
  supplierInvoiceNo: string | null;
  amount: number;
  vatAmount: number;
  taxInvoice: boolean;
  expenseDate: string;
  dueDate: string | null;
  status: string;
  paid: number;
}

interface Statement {
  name: string;
  phone: string | null;
  email: string | null;
  position: {
    outstanding: number;
    billed: number;
    paid: number;
    overdue: number;
    oldestOverdueDays: number | null;
  } | null;
  bills: StatementBill[];
}

export function SupplierStatementPage() {
  const { token } = useParams<{ token: string }>();

  const query = useQuery({
    queryKey: ['statement', token],
    queryFn: () => publicApi<Statement>(`/${token}`),
    retry: false,
    enabled: !!token,
  });

  return (
    <div className="min-h-screen bg-surface-muted px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <img src="/logo.jpeg" alt="Alken Decor Limited" className="mx-auto w-32 rounded-lg" />
        </div>

        {query.isLoading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-fg-muted">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </CardContent>
          </Card>
        )}

        {query.isError && (
          <Card>
            <CardContent className="p-6">
              <Notice tone="danger">
                {query.error instanceof PublicApiError
                  ? query.error.message
                  : 'This link is invalid or has expired.'}
              </Notice>
            </CardContent>
          </Card>
        )}

        {query.data && (
          <Card>
            <CardHeader>
              <CardTitle>{query.data.name}</CardTitle>
              <p className="text-sm text-fg-muted">
                {[query.data.phone, query.data.email].filter(Boolean).join(' · ') || 'Statement'}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Billed" value={fmtMoney(query.data.position?.billed ?? 0)} />
                <Stat label="Settled" value={fmtMoney(query.data.position?.paid ?? 0)} />
                <Stat
                  label="Outstanding"
                  value={fmtMoney(query.data.position?.outstanding ?? 0)}
                  danger={(query.data.position?.outstanding ?? 0) > 0}
                />
                <Stat
                  label="Overdue"
                  value={fmtMoney(query.data.position?.overdue ?? 0)}
                  danger={(query.data.position?.overdue ?? 0) > 0}
                />
              </div>

              {query.data.bills.length === 0 ? (
                <Empty>No bills on file yet</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Description</Th>
                        <Th className="text-right">Amount</Th>
                        <Th className="text-right">Settled</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.bills.map((b) => (
                        <tr key={b.id}>
                          <Td className="whitespace-nowrap">{fmtDate(b.expenseDate)}</Td>
                          <Td>
                            {b.description}
                            {b.supplierInvoiceNo && (
                              <p className="text-xs text-fg-subtle">
                                Invoice {b.supplierInvoiceNo}
                              </p>
                            )}
                          </Td>
                          <Td className="text-right tabular-nums">{fmtMoney(b.amount)}</Td>
                          <Td className="text-right tabular-nums">{fmtMoney(b.paid)}</Td>
                          <Td>
                            <Badge tone={b.paid >= b.amount ? 'green' : 'yellow'}>
                              {b.paid >= b.amount ? 'Settled' : 'Outstanding'}
                            </Badge>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-muted p-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${danger ? 'text-danger-fg' : 'text-fg'}`}>
        {value}
      </p>
    </div>
  );
}
