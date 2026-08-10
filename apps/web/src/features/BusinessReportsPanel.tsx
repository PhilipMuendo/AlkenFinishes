import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  Download,
  FileText,
  Fingerprint,
  Receipt,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import { isoDate, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

const REPORTS = [
  { type: 'financial-summary', label: 'Financial Summary', icon: BarChart3, ranged: false },
  { type: 'progress', label: 'Progress Report', icon: ClipboardList, ranged: false },
  { type: 'attendance', label: 'Attendance & Labour', icon: Fingerprint, ranged: true },
  { type: 'expenses', label: 'Expense Report', icon: Receipt, ranged: true },
  { type: 'client-statement', label: 'Client Statement', icon: FileText, ranged: false },
  { type: 'receivables', label: 'Retention & Receivables', icon: Wallet, ranged: false },
  { type: 'variations', label: 'Variation Orders', icon: ScrollText, ranged: false },
  { type: 'site-diary', label: 'Site Diary Digest', icon: CalendarClock, ranged: true },
] as const;

function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return isoDate(d);
}

/**
 * Every report reassembles data the live pages already show — nothing here
 * computes a new figure. The value of this panel is a clean, printable,
 * dateable snapshot to hand to a client, a bank, or the file.
 */
export function BusinessReportsPanel({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayISO());
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = useMutation({
    mutationFn: async ({ type, ranged }: { type: string; ranged: boolean }) => {
      setDownloading(type);
      const qs = ranged ? `?from=${from}&to=${to}` : '';
      const { url } = await api<{ url: string }>(`/projects/${projectId}/business-reports/${type}${qs}`);
      return url;
    },
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener');
      setDownloading(null);
    },
    onError: (e) => {
      toast.error(errText(e, 'The report could not be generated.'));
      setDownloading(null);
    },
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium text-fg">Date range</p>
        <p className="mb-3 text-xs text-fg-subtle">
          Applies to Attendance, Expenses and the Site Diary Digest — the other reports are always
          a point-in-time snapshot.
        </p>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      {download.isError && (
        <p className="text-sm text-danger-fg">
          {download.error instanceof ApiRequestError ? download.error.message : 'Failed to generate that report'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.type} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <r.icon size={18} />
              </span>
              <div>
                <p className="text-sm font-medium text-fg">{r.label}</p>
                {r.ranged && <p className="text-xs text-fg-subtle">Uses the date range above</p>}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading === r.type}
              onClick={() => download.mutate({ type: r.type, ranged: r.ranged })}
            >
              <Download size={14} />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
