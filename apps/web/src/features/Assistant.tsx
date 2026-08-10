import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUp, ExternalLink, MessageSquare, Sparkles, X } from 'lucide-react';
import { api, ApiRequestError, errText } from '@/lib/api';
import type { ChatAnswer, ChatStatus } from '@/lib/types';
import { Notice } from '@/components/ui/notice';

/**
 * Asking the system a question.
 *
 * Every answer arrives with the facts it was written from and a link to the
 * screen that owns them, for the same reason the receipt reader shows its
 * workings: in a system that moves money, an answer nobody can check is worth
 * very little. "Show what this is based on" is not a debugging aid — it is the
 * feature.
 *
 * The button is absent, not disabled, when no key is configured. A control that
 * cannot work is worse than no control.
 */

const SUGGESTIONS_OFFICE = [
  'Who do we owe the most money to?',
  'Which invoices are overdue?',
  'What is our VAT position this month?',
];
const SUGGESTIONS_SITE = [
  'What happened on site today?',
  'How is this site going?',
  'What defects are still open?',
];

interface Turn {
  question: string;
  answer?: ChatAnswer;
  error?: string;
  /** Set when the failure means there is no point asking again today. */
  spent?: boolean;
}

export function Assistant({ office }: { office: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showFacts, setShowFacts] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The site in view, so "this site" and "today" resolve without being typed.
  // Read from the path rather than useParams: this is mounted in the layout,
  // which sits above the route that carries :projectId and so never sees it.
  const { pathname } = useLocation();
  const projectId = /^\/(?:admin\/projects|sites)\/([^/?#]+)/.exec(pathname)?.[1];

  const { data: status } = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () => api<ChatStatus>('/chat/status'),
    staleTime: 60_000,
  });

  const ask = useMutation({
    mutationFn: (question: string) =>
      api<ChatAnswer>('/chat/ask', {
        body: { question, ...(projectId ? { projectId } : {}) },
      }),
    onSuccess: (answer) => {
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    },
    onError: (e) => {
      const reason =
        e instanceof ApiRequestError
          ? (e.details as { reason?: string } | undefined)?.reason
          : undefined;
      const message = errText(e, 'That question could not be answered just now.');
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? {
                ...turn,
                error: message,
                spent: reason === 'QUOTA_DAILY' || reason === 'RESERVED_FOR_WORK',
              }
            : turn,
        ),
      );
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, ask.isPending]);

  // No key configured: the assistant simply does not exist.
  if (!status?.available) return null;

  const outOfAllowance = turns.some((t) => t.spent) || status.canAsk === false;

  const submit = (question: string) => {
    const text = question.trim();
    if (!text || ask.isPending || outOfAllowance) return;
    setTurns((t) => [...t, { question: text }]);
    setQ('');
    ask.mutate(text);
  };

  const suggestions = projectId ? SUGGESTIONS_SITE : office ? SUGGESTIONS_OFFICE : SUGGESTIONS_SITE;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask about your projects"
          className={`fixed right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-brand-600 px-4 text-sm font-medium text-white shadow-lg transition-transform hover:bg-brand-700 active:scale-95 ${
            // Clear of the supervisor's bottom navigation, which the office
            // shell does not have.
            office
              ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))]'
          }`}
        >
          <Sparkles size={18} />
          <span className="hidden sm:inline">Ask</span>
        </button>
      )}

      {open && (
        <>
          <button
            aria-label="Close assistant"
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px] sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Assistant"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] animate-fade-in flex-col rounded-t-2xl border border-hairline bg-surface shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[min(36rem,80dvh)] sm:w-[26rem] sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-brand-600" />
                <h2 className="text-sm font-semibold text-fg">Ask about your projects</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-fg-muted">
                    It answers from what the system already holds — nothing is estimated, and every
                    answer shows the figures it used.
                  </p>
                  <div className="space-y-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => submit(s)}
                        disabled={outOfAllowance}
                        className="block w-full rounded-lg border border-hairline px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((turn, i) => (
                <div key={i} className="space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">
                    {turn.question}
                  </p>

                  {turn.answer && (
                    <div className="w-fit max-w-full rounded-2xl rounded-bl-sm bg-surface-sunken px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm text-fg">{turn.answer.answer}</p>

                      {turn.answer.sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                          {turn.answer.sources.map((s) => (
                            <Link
                              key={s.href}
                              to={s.href}
                              onClick={() => setOpen(false)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                            >
                              {s.label} <ExternalLink size={11} />
                            </Link>
                          ))}
                        </div>
                      )}

                      {turn.answer.facts && (
                        <>
                          <button
                            onClick={() => setShowFacts(showFacts === i ? null : i)}
                            className="mt-1.5 text-xs font-medium text-fg-subtle hover:text-fg-muted hover:underline"
                          >
                            {showFacts === i ? 'Hide' : 'Show'} what this is based on
                          </button>
                          {showFacts === i && (
                            <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface p-2 text-xs text-fg-muted">
                              {turn.answer.facts}
                            </pre>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {turn.error && (
                    <Notice tone={turn.spent ? 'warn' : 'danger'} className="text-xs">
                      {turn.error}
                    </Notice>
                  )}
                </div>
              ))}

              {ask.isPending && (
                <p className="flex items-center gap-2 text-sm text-fg-subtle">
                  <MessageSquare size={14} className="animate-pulse" /> Looking it up…
                </p>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(q);
              }}
              className="flex shrink-0 items-end gap-2 border-t border-hairline p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={outOfAllowance}
                placeholder={outOfAllowance ? 'Not available until tomorrow' : 'Ask a question…'}
                className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand-500 disabled:bg-surface-muted"
              />
              <button
                type="submit"
                aria-label="Ask"
                disabled={!q.trim() || ask.isPending || outOfAllowance}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
              >
                <ArrowUp size={17} />
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
