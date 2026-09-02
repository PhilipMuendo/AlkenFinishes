import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Tabs } from '@/components/ui/tabs';
import { fmtDate, fmtMoney } from '@/lib/format';

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

  const [method, setMethod] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [typedName, setTypedName] = useState('');
  const [consent, setConsent] = useState(false);
  const canvas = useCanvasSignature();

  const sign = useMutation({
    mutationFn: () =>
      publicApi<{ ok: true; signedPdfUrl: string | null }>(`/${token}`, {
        signerName: typedName.trim(),
        signatureMethod: method,
        signatureImage: method === 'DRAWN' ? canvas.toDataUrl() : undefined,
        consent: true,
      }),
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

              <div>
                <Tabs
                  tabs={[
                    { id: 'TYPED', label: 'Type your name' },
                    { id: 'DRAWN', label: 'Draw your signature' },
                  ]}
                  active={method}
                  onChange={(id) => setMethod(id as 'TYPED' | 'DRAWN')}
                />
                <div className="pt-4">
                  {method === 'TYPED' ? (
                    <Field label="Your full name">
                      <Input
                        value={typedName}
                        onChange={(e) => setTypedName(e.target.value)}
                        placeholder="Jane Wanjiru"
                        autoFocus
                      />
                      {typedName.trim() && (
                        <p
                          className="mt-3 border-b border-hairline-strong pb-2 text-3xl text-fg"
                          style={{ fontFamily: 'cursive' }}
                        >
                          {typedName}
                        </p>
                      )}
                    </Field>
                  ) : (
                    <div className="space-y-2">
                      <Field label="Your name">
                        <Input
                          value={typedName}
                          onChange={(e) => setTypedName(e.target.value)}
                          placeholder="Jane Wanjiru"
                        />
                      </Field>
                      <p className="text-xs text-fg-muted">Draw your signature below.</p>
                      <div className="overflow-hidden rounded-lg border border-hairline-strong bg-white">
                        <canvas
                          ref={canvas.ref}
                          className="h-40 w-full touch-none"
                          onPointerDown={canvas.onPointerDown}
                          onPointerMove={canvas.onPointerMove}
                          onPointerUp={canvas.onPointerUp}
                          onPointerLeave={canvas.onPointerUp}
                        />
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={canvas.clear}>
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>

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
                disabled={
                  sign.isPending ||
                  !consent ||
                  !typedName.trim() ||
                  (method === 'DRAWN' && canvas.isEmpty)
                }
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

/** A minimal pointer-driven signature pad, exported as a PNG data URL on submit. */
function useCanvasSignature() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#111827';
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = ref.current?.getContext('2d');
    const { x, y } = point(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    const { x, y } = point(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setIsEmpty(false);
  };
  const onPointerUp = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setIsEmpty(true);
  };
  const toDataUrl = () => ref.current?.toDataURL('image/png') ?? '';

  return { ref, onPointerDown, onPointerMove, onPointerUp, clear, toDataUrl, isEmpty };
}
