import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Download, PenLine, Send, XCircle } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { HandoverChecklist, HandoverItem } from '@/lib/types';
import { fmtDate, thumbUrl } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { toast } from '@/components/ui/toast';
import { SignaturePad, type SignaturePadHandle } from '@/features/SignaturePad';

const MAX_PHOTOS = 10;

/**
 * The handover sign-off. Shared between the Supervisor site page (ticking
 * the manual items, uploading photos) and the admin project page (sending
 * for client signature, countersigning) — `isAdmin` from useAuth gates the
 * office-only actions rather than this being two separate components.
 */
export function HandoverPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPERADMIN';

  const query = useQuery({
    queryKey: ['handover', projectId],
    queryFn: () => api<HandoverChecklist>(`/projects/${projectId}/handover`),
  });
  const { data } = query;

  const [manualItems, setManualItems] = useState<HandoverItem[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [signingLinkUrl, setSigningLinkUrl] = useState<string | null>(null);
  const [countersigning, setCountersigning] = useState(false);
  const [countersignReady, setCountersignReady] = useState(false);
  const countersignPadRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (data) setManualItems(data.manualItems);
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['handover', projectId] });

  const save = useMutation({
    mutationFn: (formData: FormData) =>
      api<HandoverChecklist>(`/projects/${projectId}/handover`, { method: 'PUT', formData }),
    onSuccess: () => {
      toast.success('Handover checklist saved.');
      invalidate();
      setPhotoCount(0);
    },
    onError: (e) => toast.error(errText(e, 'The checklist was not saved.')),
  });

  const createSigningLink = useMutation({
    mutationFn: () => api<{ token: string; expiresAt: string }>(`/projects/${projectId}/handover/signing-link`, { body: {} }),
    onSuccess: (res) => {
      const url = `${window.location.origin}/handover/${res.token}`;
      setSigningLinkUrl(url);
      navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success('Signing link copied. Share it with the client — it works for 14 days.');
    },
    onError: (e) => toast.error(errText(e, 'The signing link was not created.')),
  });

  const countersign = useMutation({
    mutationFn: (body: { signerName: string; signatureMethod: 'TYPED' | 'DRAWN'; signatureImage?: string }) =>
      api<HandoverChecklist>(`/projects/${projectId}/handover/countersign`, { body }),
    onSuccess: () => {
      toast.success('Countersigned. The handover certificate now carries both signatures.');
      invalidate();
      setCountersigning(false);
    },
    onError: (e) => toast.error(errText(e, 'The countersignature was not recorded.')),
  });

  if (!data) return <QueryState query={query} rows={4} noun="the handover checklist" />;

  const alreadySigned = !!data.clientSignedAt;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Handover checklist</CardTitle>
          <p className="text-xs text-fg-muted">
            "Final quality inspection completed" and "Snags closed" are worked out automatically from
            the Quality Inspection and Snag list tabs.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.items.map((item) => {
            const auto = item.auto;
            const manualIndex = manualItems.findIndex((m) => m.label === item.label);
            const checked = auto ? item.checked : (manualItems[manualIndex]?.checked ?? false);
            return (
              <label
                key={item.label}
                className={`flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 ${
                  auto ? 'opacity-80' : 'cursor-pointer'
                }`}
              >
                <span className="text-sm text-fg">{item.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {auto && <span className="text-xs text-fg-subtle">Auto</span>}
                  {checked ? (
                    <CheckCircle2 size={18} className="text-good-fg" />
                  ) : (
                    <XCircle size={18} className="text-fg-subtle" />
                  )}
                  {!auto && !alreadySigned && (
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={(e) =>
                        setManualItems((prev) =>
                          prev.map((m, i) => (i === manualIndex ? { ...m, checked: e.target.checked } : m)),
                        )
                      }
                    />
                  )}
                </span>
              </label>
            );
          })}
        </CardContent>
      </Card>

      {!alreadySigned && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('items', JSON.stringify(manualItems));
            save.mutate(fd);
          }}
          className="space-y-3"
        >
          <Field label="Notes (optional)">
            <Textarea name="notes" defaultValue={data.notes ?? ''} />
          </Field>
          <Field
            label={`Handover photographs (up to ${MAX_PHOTOS})`}
            hint={photoCount > 0 ? `${photoCount} selected` : undefined}
          >
            <Input
              name="photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
            />
          </Field>
          {data.photoUrls.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {data.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={thumbUrl(url, 160)} alt="Handover" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
                </a>
              ))}
            </div>
          )}
          {save.isError && <p className="text-sm text-danger-fg">{errText(save.error, 'Failed to save')}</p>}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            Save checklist
          </Button>
        </form>
      )}

      {isAdmin && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Client sign-off</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.clientSignerName ? (
              <p className="text-sm text-fg-muted">
                Signed by {data.clientSignerName} on {fmtDate(data.clientSignedAt!)}
              </p>
            ) : (
              <>
                <p className="text-sm text-fg-muted">
                  {data.complete
                    ? 'Every checklist item is complete — ready to send for signature.'
                    : 'Complete every checklist item before sending this for signature.'}
                </p>
                <Button disabled={!data.complete || createSigningLink.isPending} onClick={() => createSigningLink.mutate()}>
                  <Send size={16} /> Send for client signature
                </Button>
              </>
            )}

            {data.companySignerName ? (
              <p className="text-sm text-fg-muted">
                Countersigned by {data.companySignerName} on {fmtDate(data.companySignedAt!)}
              </p>
            ) : (
              alreadySigned && (
                <Button variant="outline" onClick={() => setCountersigning(true)}>
                  <PenLine size={16} /> Countersign
                </Button>
              )
            )}

            {data.pdfUrl && (
              <a href={data.pdfUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <Download size={14} /> Handover certificate PDF
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!signingLinkUrl}
        onClose={() => setSigningLinkUrl(null)}
        title="Signing link ready"
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Copied to your clipboard. Share it with the client — it works for 14 days.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-muted p-2.5 text-xs">
            <code className="min-w-0 flex-1 truncate">{signingLinkUrl}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => signingLinkUrl && navigator.clipboard?.writeText(signingLinkUrl)}
            >
              <Copy size={14} />
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={countersigning}
        onClose={() => {
          setCountersigning(false);
          countersign.reset();
        }}
        title="Countersign this handover"
      >
        <div className="space-y-3">
          <SignaturePad ref={countersignPadRef} onReadyChange={setCountersignReady} />
          {countersign.isError && (
            <p className="text-sm text-danger-fg">{errText(countersign.error, 'Failed')}</p>
          )}
          <Button
            className="w-full"
            disabled={!countersignReady || countersign.isPending}
            onClick={() => {
              const signature = countersignPadRef.current?.getSignature();
              if (signature) countersign.mutate(signature);
            }}
          >
            {countersign.isPending ? 'Saving…' : 'Countersign'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
