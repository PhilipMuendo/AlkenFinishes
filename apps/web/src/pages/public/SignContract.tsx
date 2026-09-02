import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { fmtDate, fmtMoney } from '@/lib/format';
import { SignaturePad, type SignaturePadHandle } from '@/features/SignaturePad';

/**
 * A client opens this with no login of their own — clients are never `User`
 * accounts in this system. It talks to the API directly rather than through
 * `lib/api.ts`'s `api()` helper, which is wired for an authenticated
 * session (tokens, silent refresh, a 401-triggered logout redirect); none
 * of that applies here, and reusing it risks that machinery firing on a
 * page that has no session to lose.
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
  const res = await fetch(`/api/v1/sign${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublicApiError(res.status, payload.error ?? 'Something went wrong');
  return payload as T;
}

interface SigningSummary {
  title: string;
  contractNo: string | null;
  clientName: string;
  originalValue: number;
  vatRatePct: number;
  startDate: string;
  expectedCompletion: string;
  unsignedPdfUrl: string | null;
}

export function SignContractPage() {
  const { token } = useParams<{ token: string }>();

  const summaryQuery = useQuery({
    queryKey: ['sign', token],
    queryFn: () => publicApi<SigningSummary>(`/${token}`),
    retry: false,
    enabled: !!token,
  });

  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  const sign = useMutation({
    mutationFn: () => {
      const signature = padRef.current?.getSignature();
      if (!signature) throw new PublicApiError(0, 'Finish your signature before continuing');
      return publicApi<{ ok: true; signedPdfUrl: string | null }>(`/${token}`, {
        ...signature,
        consent: true,
      });
    },
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

        {sign.isSuccess && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <CheckCircle2 size={40} className="text-good-fg" />
              <p className="text-lg font-semibold text-fg">Contract signed</p>
              <p className="text-sm text-fg-muted">
                Thank you — a copy of the executed contract is available below.
              </p>
              {sign.data.signedPdfUrl && (
                <Button onClick={() => window.open(sign.data.signedPdfUrl!, '_blank')}>
                  View the signed contract
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {summaryQuery.data && !sign.isSuccess && (
          <Card>
            <CardHeader>
              <CardTitle>{summaryQuery.data.title}</CardTitle>
              <p className="text-sm text-fg-muted">
                {summaryQuery.data.contractNo ?? 'Draft'} · {summaryQuery.data.clientName}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
                <Row label="Contract sum (excl. VAT)" value={fmtMoney(summaryQuery.data.originalValue)} />
                <Row label="VAT" value={`${summaryQuery.data.vatRatePct}%`} />
                <Row label="Commencement" value={fmtDate(summaryQuery.data.startDate)} />
                <Row
                  label="Contractual completion"
                  value={fmtDate(summaryQuery.data.expectedCompletion)}
                />
              </div>

              {summaryQuery.data.unsignedPdfUrl && (
                <a
                  href={summaryQuery.data.unsignedPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center text-sm font-medium text-brand-700 hover:underline"
                >
                  Read the full contract before signing
                </a>
              )}

              <SignaturePad ref={padRef} onReadyChange={setReady} />

              <Notice as="label" tone="info" icon={PenLine}>
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    I am authorised to sign this on behalf of {summaryQuery.data.clientName}, and I
                    agree this electronic signature is legally binding.
                  </span>
                </span>
              </Notice>

              {sign.isError && (
                <p className="text-sm text-danger-fg">
                  {sign.error instanceof PublicApiError ? sign.error.message : 'Signing failed.'}
                </p>
              )}

              <Button
                size="lg"
                className="w-full"
                disabled={sign.isPending || !consent || !ready}
                onClick={() => sign.mutate()}
              >
                {sign.isPending ? 'Signing…' : 'Sign contract'}
              </Button>
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

