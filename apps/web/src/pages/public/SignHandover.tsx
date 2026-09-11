import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { SignaturePad, type SignaturePadHandle } from '@/features/SignaturePad';

/**
 * A client opens this with no login of their own, same reasoning as
 * SignContract.tsx — a direct fetch against the public API, not lib/api.ts's
 * authenticated helper.
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
  const res = await fetch(`/api/v1/handover${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublicApiError(res.status, payload.error ?? 'Something went wrong');
  return payload as T;
}

interface HandoverSummary {
  projectName: string;
  clientName: string;
  items: { label: string; checked: boolean }[];
  notes: string | null;
  photoUrls: string[];
}

export function SignHandoverPage() {
  const { token } = useParams<{ token: string }>();

  const summaryQuery = useQuery({
    queryKey: ['handover-sign', token],
    queryFn: () => publicApi<HandoverSummary>(`/${token}`),
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
      return publicApi<{ ok: true; pdfUrl: string | null }>(`/${token}`, {
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
              <p className="text-lg font-semibold text-fg">Handover confirmed</p>
              <p className="text-sm text-fg-muted">
                Thank you — a copy of the handover certificate is available below.
              </p>
              {sign.data.pdfUrl && (
                <Button onClick={() => window.open(sign.data.pdfUrl!, '_blank')}>
                  View the handover certificate
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {summaryQuery.data && !sign.isSuccess && (
          <Card>
            <CardHeader>
              <CardTitle>Handover — {summaryQuery.data.projectName}</CardTitle>
              <p className="text-sm text-fg-muted">{summaryQuery.data.clientName}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-hairline bg-surface-muted p-3 text-sm">
                {summaryQuery.data.items.map((i) => (
                  <div key={i.label} className="flex items-center justify-between gap-3 py-1">
                    <span className="text-fg-muted">{i.label}</span>
                    <span className={i.checked ? 'font-medium text-good-fg' : 'text-fg-subtle'}>
                      {i.checked ? 'Complete' : 'Outstanding'}
                    </span>
                  </div>
                ))}
              </div>

              {summaryQuery.data.notes && (
                <div className="rounded-lg border border-hairline p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Notes</p>
                  <p className="mt-1 whitespace-pre-line text-fg">{summaryQuery.data.notes}</p>
                </div>
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
                    I confirm the work has been handed over to my satisfaction, and I agree this
                    electronic signature is legally binding.
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
                {sign.isPending ? 'Confirming…' : 'Confirm handover'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
