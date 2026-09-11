import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, Download } from 'lucide-react';
import { api, errText } from '@/lib/api';
import type { WeeklyProgressData, WeeklyProgressReport } from '@/lib/types';
import { fmtDate, fmtMoney, fmtWeekRange, isoDate, weekEndingOf } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Table, Td, Th, Empty } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

const thisWeekEnding = () => weekEndingOf(isoDate(new Date()));

/**
 * Planned vs Actual, for one week at a time. `/preview` is live and saves
 * nothing — a supervisor can page back and forth over past weeks freely.
 * "Finalise this week" is the only action that writes anything, and it
 * freezes exactly what the preview showed at that moment (see
 * services/weeklyProgress.ts) into history below.
 */
export function WeeklyProgressPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [weekEnding, setWeekEnding] = useState(thisWeekEnding);

  const previewQuery = useQuery({
    queryKey: ['weekly-progress', 'preview', projectId, weekEnding],
    queryFn: () =>
      api<WeeklyProgressData>(`/projects/${projectId}/weekly-progress/preview?weekEnding=${weekEnding}`),
  });
  const { data } = previewQuery;

  const historyQuery = useQuery({
    queryKey: ['weekly-progress', projectId],
    queryFn: () => api<WeeklyProgressReport[]>(`/projects/${projectId}/weekly-progress`),
  });
  const { data: history } = historyQuery;
  const filedForWeek = history?.find((r) => r.weekEnding === weekEnding) ?? null;

  const finalise = useMutation({
    mutationFn: () =>
      api<WeeklyProgressReport>(`/projects/${projectId}/weekly-progress`, { body: { weekEnding } }),
    onSuccess: () => {
      toast.success('Week finalised. The PDF is ready below.');
      void qc.invalidateQueries({ queryKey: ['weekly-progress', projectId] });
    },
    onError: (e) => toast.error(errText(e, 'This week could not be finalised.')),
  });

  return (
    <div className="space-y-4">
      <Field label="Week ending" hint={fmtWeekRange(weekEnding)}>
        <Input
          type="date"
          value={weekEnding}
          onChange={(e) => setWeekEnding(e.target.value ? weekEndingOf(e.target.value) : thisWeekEnding())}
          className="w-44"
        />
      </Field>

      {filedForWeek && (
        <p className="flex items-center gap-1.5 rounded-lg bg-good-surface p-2.5 text-xs text-good-fg ring-1 ring-inset ring-good-hairline">
          <CheckCircle2 size={14} /> Finalised by {filedForWeek.generatedBy.name} on{' '}
          {fmtDate(filedForWeek.generatedAt)}. The figures below are live — finalise again to update
          the record.
        </p>
      )}

      <QueryState query={previewQuery} rows={4} noun="this week's figures" />

      {data && (
        <>
          <Card className="overflow-hidden">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Quantities</CardTitle>
              <p className="text-xs text-fg-muted">Planned vs done so far, for tasks tracking a quantity</p>
            </CardHeader>
            {data.quantities.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-fg-muted">
                No tasks have a planned quantity set yet — add one from the Tasks tab.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th priority="sm">Unit</Th>
                    <Th className="text-right">Planned</Th>
                    <Th className="text-right">Actual</Th>
                    <Th className="text-right">Variance</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.quantities.map((q) => (
                    <tr key={q.item}>
                      <Td className="font-medium text-fg">{q.item}</Td>
                      <Td priority="sm">{q.unit || '—'}</Td>
                      <Td className="text-right tabular-nums">{q.planned}</Td>
                      <Td className="text-right tabular-nums">{q.actual}</Td>
                      <Td
                        className={`text-right font-medium tabular-nums ${q.variance < 0 ? 'text-warn-fg' : 'text-fg'}`}
                      >
                        {q.variance > 0 ? '+' : ''}
                        {q.variance}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <VarianceLine label="Overall" value={`${data.completion.overallPct}%`} strong />
              {data.completion.byPhase.map((p) => (
                <VarianceLine key={p.phase} label={p.phase} value={`${p.pct}%`} />
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">Labour (man-days)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <VarianceLine label="Planned" value={data.labour.plannedDays ?? '—'} />
                <VarianceLine label="Actual" value={data.labour.actualDays} strong />
                {data.labour.variance != null && (
                  <VarianceLine
                    label="Variance"
                    value={`${data.labour.variance > 0 ? '+' : ''}${data.labour.variance}`}
                    tone={data.labour.variance > 0 ? 'warn' : undefined}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">Materials</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <VarianceLine label="Planned" value={fmtMoney(data.materials.planned)} />
                <VarianceLine label="Actual" value={fmtMoney(data.materials.actual)} strong />
                <VarianceLine
                  label="Variance"
                  value={`${data.materials.variance > 0 ? '+' : ''}${fmtMoney(data.materials.variance)}`}
                  tone={data.materials.variance > 0 ? 'warn' : undefined}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Money spent (all categories)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <VarianceLine label="Budget" value={fmtMoney(data.money.planned)} />
              <VarianceLine label="Spent to date" value={fmtMoney(data.money.actual)} strong />
              <VarianceLine
                label="Variance"
                value={`${data.money.variance > 0 ? '+' : ''}${fmtMoney(data.money.variance)}`}
                tone={data.money.variance > 0 ? 'warn' : undefined}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Outstanding work</CardTitle>
            </CardHeader>
            {data.outstandingWork.length === 0 ? (
              <Empty icon={CheckCircle2}>
                <p className="font-medium text-fg">Nothing outstanding</p>
                <p className="mt-1 text-fg-muted">Every task is marked done.</p>
              </Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Phase</Th>
                    <Th>Task</Th>
                    <Th priority="sm">Status</Th>
                    <Th className="text-right">% complete</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.outstandingWork.map((t) => (
                    <tr key={`${t.phase}-${t.name}`}>
                      <Td>{t.phase}</Td>
                      <Td className="font-medium text-fg">{t.name}</Td>
                      <Td priority="sm">{t.status.replace('_', ' ')}</Td>
                      <Td className="text-right tabular-nums">{t.completionPct}%</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Button className="w-full" onClick={() => finalise.mutate()} disabled={finalise.isPending}>
            {filedForWeek ? 'Re-finalise this week' : 'Finalise this week'}
          </Button>
        </>
      )}

      <QueryState query={historyQuery} rows={2} noun="past reports" />
      {history && history.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">History</CardTitle>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Week ending</Th>
                <Th priority="sm">Finalised by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-fg">
                    {fmtDate(r.weekEnding)}
                    <Badge tone="blue" className="ml-2">
                      {r.data.completion.overallPct}%
                    </Badge>
                  </Td>
                  <Td priority="sm">
                    {r.generatedBy.name} · {fmtDate(r.generatedAt)}
                  </Td>
                  <Td className="text-right">
                    {r.pdfUrl && (
                      <a href={r.pdfUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline">
                          <Download size={14} /> PDF
                        </Button>
                      </a>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {history?.length === 0 && !data && (
        <Empty icon={BarChart3}>
          <p className="font-medium text-fg">No weeks finalised yet</p>
        </Empty>
      )}
    </div>
  );
}

function VarianceLine({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string | number;
  strong?: boolean;
  tone?: 'warn';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? 'font-medium text-fg' : 'text-fg-muted'}>{label}</span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? 'text-lg font-semibold' : ''} ${
          tone === 'warn' ? 'text-warn-fg' : 'text-fg'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
