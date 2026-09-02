import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { fmtDate, fmtMoney } from '@/lib/format';

/**
 * A client accepting or declining a quotation with no login of their own.
 * Talks to the API with a bare `fetch`, same reasoning as `SignContract.tsx`
 * — this page has no session at all, so the token-authenticated `api()`
 * client (which assumes one) is the wrong tool here.
 */

class PublicApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function publicApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/quote${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublicApiError(res.status, payload.error ?? 'Something went wrong');
  return payload as T;
}

interface QuoteSummary {
  title: string;
  quotationNo: string | null;
  clientName: string;
  total: number;
  vatRatePct: number;
  validUntil: string;
  pdfUrl: string | null;
}

export function DecideQuotationPage() {
  const { token } = useParams<{ token: string }>();

  const summaryQuery = useQuery({
    queryKey: ['quote', token],
    queryFn: () => publicApi<QuoteSummary>(`/${token}`),
    retry: false,
    enabled: !!token,
  });

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: (vars: { outcome: 'ACCEPTED' | 'REJECTED'; reason?: string }) =>
      publicApi<{ ok: true; status: string }>(`/${token}`, vars),
  });

  return (
    <div className="min-h-screen bg-surface-muted px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <img src="/logo.jpeg" alt="Alken Decor Limited" className="mx-auto w-32 rounded-lg" />
        </div>

        {summaryQuery.isLoading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-fg-muted">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </CardContent>
          </Card>
        )}

        {summaryQuery.isError && (
          <Card>
            <CardContent className="p-6">
              <Notice tone="danger">
                {summaryQuery.error instanceof PublicApiError
                  ? summaryQuery.error.message
                  : 'This link is invalid or has expired.'}
              </Notice>
            </CardContent>
          </Card>
        )}

        {decide.isSuccess && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              {decide.data.status === 'ACCEPTED' ? (
                <>
                  <CheckCircle2 size={40} className="text-good-fg" />
                  <p className="text-lg font-semibold text-fg">Quotation accepted</p>
                  <p className="text-sm text-fg-muted">
                    Thank you — we&rsquo;ll be in touch to get the contract moving.
                  </p>
                </>
              ) : (
                <>
                  <XCircle size={40} className="text-fg-subtle" />
                  <p className="text-lg font-semibold text-fg">Quotation declined</p>
                  <p className="text-sm text-fg-muted">
                    Thanks for letting us know. Your reason has been recorded.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {summaryQuery.data && !decide.isSuccess && (
          <Card>
            <CardHeader>
              <CardTitle>{summaryQuery.data.title}</CardTitle>
              <p className="text-sm text-fg-muted">
                {summaryQuery.data.quotationNo ?? 'Draft'} · {summaryQuery.data.clientName}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
                <Row label="Total (incl. VAT)" value={fmtMoney(summaryQuery.data.total)} />
                <Row label="VAT rate" value={`${summaryQuery.data.vatRatePct}%`} />
                <Row label="Valid until" value={fmtDate(summaryQuery.data.validUntil)} />
              </div>

              {summaryQuery.data.pdfUrl && (
                <a
                  href={summaryQuery.data.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center text-sm font-medium text-brand-700 hover:underline"
                >
                  Read the full quotation
                </a>
              )}

              {decide.isError && (
                <p className="text-sm text-danger-fg">
                  {decide.error instanceof PublicApiError
                    ? decide.error.message
                    : 'That could not be recorded.'}
                </p>
              )}

              {declining ? (
                <div className="space-y-3">
                  <Field label="Why are you declining?" hint="A sentence is enough.">
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      autoFocus
                      rows={3}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setDeclining(false)}
                    >
                      Back
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={decide.isPending || !reason.trim()}
                      onClick={() => decide.mutate({ outcome: 'REJECTED', reason })}
                    >
                      {decide.isPending ? 'Sending…' : 'Confirm decline'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={decide.isPending}
                    onClick={() => setDeclining(true)}
                  >
                    Decline
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ outcome: 'ACCEPTED' })}
                  >
                    {decide.isPending ? 'Sending…' : 'Accept'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}
