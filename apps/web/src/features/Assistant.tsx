import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUp, ExternalLink, MessageSquare, RotateCcw, Sparkles, X } from 'lucide-react';
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
  'Which sites are active?',
  'Who do we owe the most money to?',
  'How many fundis do we have?',
  'What needs my attention?',
];
const SUGGESTIONS_SITE = [
  'What happened on site today?',
  'What defects are still open?',
  'Who has been on site this week?',
  'What materials are we waiting on?',
];

const ATTENTION_QUESTION = 'What needs my attention?';
/** localStorage key holding the YYYY-MM-DD the digest last auto-ran. */
const AUTO_ATTENTION_KEY = 'assistant.autoAttention.lastRun';
/**
 * Auto-asks `ATTENTION_QUESTION` once per office user per day, the moment the
 * panel is opened, so the digest the Overview page shows also greets whoever
 * opens the assistant instead of waiting to be asked. This costs the same two
 * model calls as asking it by hand, against the shared daily AI quota
 * (services/aiUsage.ts on the server) — flip to false to turn it off without
 * touching the gating logic below.
 */
const AUTO_ASK_ATTENTION_ON_OPEN = true;

interface Turn {
  question: string;
  answer?: ChatAnswer;
  error?: string;
  /** Set when the failure means there is no point asking again today. */
  spent?: boolean;
}

/**
 * How far the on-screen keyboard has eaten into the window.
 *
 * A panel pinned to `bottom-0` sits underneath the keyboard on Android, where
 * the layout viewport deliberately does not shrink — so the field being typed
 * into is the one thing hidden. `dvh` does not help: it tracks browser chrome,
 * not the keyboard. The visual viewport is the only thing that actually knows,
 * and on desktop it stays 0 and costs nothing.
 */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const read = () => {
      // How much of the window the viewport no longer covers, from the bottom.
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      // Small values are browser chrome, not a keyboard. Ignore the noise.
      setInset(hidden > 120 ? hidden : 0);
    };
    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => {
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
    };
  }, [active]);

  useEffect(() => {
    if (!active) setInset(0);
  }, [active]);

  return inset;
}

export function Assistant({ office }: { office: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showFacts, setShowFacts] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const keyboard = useKeyboardInset(open);

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
        body: {
          question,
          ...(projectId ? { projectId } : {}),
          // What has already been asked and answered, so "how is it going?"
          // means something. Only exchanges that produced an answer: a failed
          // turn tells the planner nothing and would only crowd the prompt.
          history: turns
            .filter((t) => t.answer)
            .slice(-4)
            .map((t) => ({ question: t.question, answer: t.answer!.answer })),
        },
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
  }, [turns, ask.isPending, keyboard]);

  const close = useCallback(() => {
    setOpen(false);
    // Send focus back where it came from, or a keyboard user is dropped at the
    // top of the page having lost their place.
    launcherRef.current?.focus();
  }, []);

  // Escape closes it. The native <dialog> gives this away free, but this panel
  // cannot be one: a modal dialog is the wrong shape for something meant to sit
  // beside the page you are asking about.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Fires on the transition to open, not on every render while open — a
  // supervisor never sees this (company_operations is office-only, and asking
  // it on their behalf would just be a refusal), and it only ever fires once
  // per calendar day regardless of how many times the panel is reopened.
  useEffect(() => {
    if (!AUTO_ASK_ATTENTION_ON_OPEN || !open || !office) return;
    if (!status?.available || status.canAsk !== true) return;
    if (turns.length > 0 || ask.isPending) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(AUTO_ATTENTION_KEY) === todayStr) return;
    localStorage.setItem(AUTO_ATTENTION_KEY, todayStr);

    setTurns((t) => [...t, { question: ATTENTION_QUESTION }]);
    ask.mutate(ATTENTION_QUESTION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  /** Ask the same question again, replacing the turn that failed. */
  const retry = (index: number) => {
    const turn = turns[index];
    if (!turn || ask.isPending || outOfAllowance) return;
    setTurns((t) => t.map((x, i) => (i === index ? { question: x.question } : x)));
    ask.mutate(turn.question);
  };

  const suggestions = projectId ? SUGGESTIONS_SITE : office ? SUGGESTIONS_OFFICE : SUGGESTIONS_SITE;

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          onClick={() => setOpen(true)}
          aria-label="Ask about your sites"
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
          {/* Mobile only, where the panel fills the screen and genuinely is
              modal. On a desktop it sits beside the page being asked about,
              which stays usable — so no backdrop, and no aria-modal claiming
              otherwise to a screen reader. */}
          <button
            aria-label="Close assistant"
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px] sm:hidden"
            onClick={close}
          />
          <div
            role="dialog"
            aria-label="Assistant"
            // The keyboard inset lifts the panel clear of the on-screen
            // keyboard; it is 0 on desktop and whenever the keyboard is down.
            style={keyboard ? { bottom: keyboard } : undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] animate-fade-in flex-col rounded-t-2xl border border-hairline bg-surface shadow-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[min(36rem,80dvh)] sm:w-[26rem] sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles size={16} className="shrink-0 text-brand-600" />
                <h2 className="truncate text-sm font-semibold text-fg">Ask about your projects</h2>
              </div>
              <div className="flex shrink-0 items-center">
                {turns.length > 0 && (
                  <button
                    onClick={() => {
                      setTurns([]);
                      setShowFacts(null);
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg px-2 py-1.5 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={close}
                  aria-label="Close"
                  className="-mr-1 rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-surface-sunken hover:text-fg"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Answers arrive after a pause and replace nothing on screen, so a
                screen reader is told about them rather than left waiting. */}
            <div
              aria-live="polite"
              aria-atomic="false"
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
            >
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
                        className="block min-h-[2.75rem] w-full rounded-lg border border-hairline px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((turn, i) => (
                <div key={i} className="space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] break-words rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">
                    {turn.question}
                  </p>

                  {turn.answer && (
                    <div className="w-fit max-w-full rounded-2xl rounded-bl-sm bg-surface-sunken px-3 py-2">
                      <p className="whitespace-pre-wrap break-words text-sm text-fg">
                        {turn.answer.answer}
                      </p>

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
                    <div className="space-y-1.5">
                      <Notice tone={turn.spent ? 'warn' : 'danger'} className="text-xs">
                        {turn.error}
                      </Notice>
                      {/* A rate limit or a dropped connection clears on its
                          own; retyping the question to find out is busywork.
                          Not offered when the allowance is spent, because
                          then it genuinely cannot succeed. */}
                      {!turn.spent && i === turns.length - 1 && (
                        <button
                          onClick={() => retry(i)}
                          disabled={ask.isPending}
                          className="inline-flex min-h-[2rem] items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-xs font-medium text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg disabled:opacity-50"
                        >
                          <RotateCcw size={13} /> Try again
                        </button>
                      )}
                    </div>
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
                ref={inputRef}
                // Opening the panel is unambiguously an intent to type. Held
                // back on touch, where focusing throws the keyboard up over
                // the suggestions before they have been read.
                autoFocus={typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={outOfAllowance}
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="off"
                placeholder={outOfAllowance ? 'Not available until tomorrow' : 'Ask a question…'}
                // 16px on a phone or iOS zooms the page in on focus and stays
                // there. See components/ui/input.tsx.
                className="min-h-[2.75rem] min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-base text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand-500 disabled:bg-surface-muted sm:min-h-0 sm:text-sm"
              />
              <button
                type="submit"
                aria-label="Ask"
                disabled={!q.trim() || ask.isPending || outOfAllowance}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40 sm:h-9 sm:w-9"
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
