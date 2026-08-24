import { generate, AiError } from './ai';
import {
  catalogueFor,
  runLookup,
  RetrievalDenied,
  visibleProjects,
  type ChatUser,
} from './chatRetrieval';
import { recordCall } from './aiUsage';

/**
 * Answering a question about the business.
 *
 * Two steps, deliberately.
 *
 * FIRST the model chooses which of a fixed set of lookups would answer the
 * question. It is choosing from a menu, not writing a query — it never sees the
 * schema and cannot compose an aggregate of its own. SECOND it is handed the
 * facts those lookups returned and asked to write the sentence.
 *
 * The arithmetic therefore never passes through the model. Every figure in
 * every answer was computed by the same service functions that produce the
 * figure on the screen, so the assistant cannot disagree with the app; the
 * worst it can do is choose the wrong lookup, which shows up as an answer about
 * the wrong thing rather than a wrong number about the right one.
 *
 * The facts are returned to the caller alongside the answer, for the same
 * reason the receipt reader shows its workings: an answer that cannot be
 * checked is worth very little in a system that moves money.
 */

export interface ChatSource {
  label: string;
  href: string;
}

export interface ChatAnswer {
  answer: string;
  /** The lookups that ran, so the user can see what was consulted. */
  used: string[];
  /** The raw facts the answer was written from. */
  facts: string;
  sources: ChatSource[];
}

/** One earlier exchange, for resolving "it" and "that site" in a follow-up. */
export interface ChatTurn {
  question: string;
  answer: string;
}

/**
 * How much of the conversation the planner is shown.
 *
 * Enough for a follow-up to resolve, short enough that the prompt does not
 * grow without bound over a long session — and short enough that a stale
 * subject from ten questions ago cannot quietly capture a new one.
 */
const HISTORY_TURNS = 4;

/** How many lookups one question may trigger. Each is a database read, not a model call. */
const MAX_LOOKUPS = 4;

const PLANNER_SYSTEM = `You route a question about a Kenyan construction company to the data that answers it.

Return ONLY JSON: {"lookups":[{"name":"...","args":{...}}],"decline":null}

Rules:
- Choose at most ${MAX_LOOKUPS} lookups from the catalogue, fewest that will answer the question.
- Use ONLY lookup names from the catalogue. Never invent one.
- Pass projectId only from the site list given. Match on the site name in the question. If the question is about a site but names none, and there is exactly one site, use it; otherwise set decline to "which site?".
- Dates are YYYY-MM-DD, months are YYYY-MM.
- If nothing in the catalogue can answer the question, return {"lookups":[],"decline":"<short reason>"}.
- The catalogue reflects what this user is allowed to see. If the question asks for something not in it, decline; do not substitute something else.

Follow-ups:
- Earlier turns are given only so a follow-up can be resolved. "It", "there", "that site" and "what about X?" mean whatever the previous turn was about — carry the site and the subject forward.
- A question that names its own subject is not a follow-up. Do not let an earlier site capture it.

Choosing well:
- A question asking WHICH, WHO, WHAT ARE or HOW MANY needs the lookup that LISTS that kind of thing. The site list below names the sites but carries nothing else about them — never answer from it alone.
- A question about one site that does not say which, when the user is looking at a site, means that site.
- When a question spans two subjects ("defects and safety on X"), pick a lookup for each rather than the closest single one.
- Prefer the narrowest lookup that covers the question. Reach for a company-wide one only when the question is genuinely company-wide.`;

const ANSWER_SYSTEM = `You answer questions about a Kenyan construction company, for the person running it.

You are given FACTS retrieved from the system. Rules:
- Use ONLY the facts. Never estimate, extrapolate or add a figure that is not there.
- Every number you state must appear in the facts, in the same form. Do not add figures together to make a new one; if the total is not in the facts, do not give a total.
- If the facts do not answer the question, say plainly what is missing. Do not fill the gap.
- Answer in two or three short sentences. Plain English, no preamble.
- If the question asks WHICH or WHO, name them. A list question gets the list, one short line each, not a count — the names are in the facts, so use them.
- Money is already formatted as "KES 1,234,000" in the facts. Repeat it exactly as given.
- Do not describe the lookup process or mention "the facts", "the data" or "the system". Just answer.
- If the facts are general background rather than this company's own figures (they will say so plainly), make clear in your answer that it is general information to verify, not a number from this company's own records — do not present it with the same certainty as a figure that came from the company's data.`;

interface Plan {
  lookups: { name: string; args: Record<string, string> }[];
  decline: string | null;
}

/**
 * The first complete JSON object in a reply.
 *
 * Taking everything between the first `{` and the last `}` looks equivalent
 * and is not: a model that emits an object followed by anything else carrying
 * a brace — a second object, a fenced explanation — produces a slice that is
 * two objects long and fails to parse, losing an answer that was sitting right
 * there in the first one. Braces are matched instead, ignoring those inside
 * strings, so trailing commentary is simply left behind.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** The planner's reply is untrusted: unknown shapes are dropped, not coerced. */
export function parsePlan(text: string): Plan {
  const json = firstJsonObject(text);
  if (!json) throw new Error('unparseable plan');
  const raw = JSON.parse(json) as Record<string, unknown>;

  const decline = typeof raw.decline === 'string' && raw.decline.trim() ? raw.decline.trim() : null;
  const list = Array.isArray(raw.lookups) ? raw.lookups : [];

  const lookups = list
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => {
      const args: Record<string, string> = {};
      const rawArgs = l.args;
      if (rawArgs && typeof rawArgs === 'object') {
        for (const [k, v] of Object.entries(rawArgs as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'number') args[k] = String(v);
        }
      }
      return { name: typeof l.name === 'string' ? l.name : '', args };
    })
    .filter((l) => l.name)
    .slice(0, MAX_LOOKUPS);

  return { lookups, decline };
}

/**
 * The conversation so far, as the planner is shown it.
 *
 * Only the last few turns: enough for "how is it going?" to resolve, bounded
 * so a long session cannot grow the prompt without limit, and short enough
 * that a subject from ten questions ago cannot capture a new one. Empty turns
 * are dropped rather than sent as blank lines the model has to interpret.
 */
export function formatHistory(history: ChatTurn[]): string {
  const recent = history
    .filter((t) => t.question.trim() && t.answer.trim())
    .slice(-HISTORY_TURNS);
  if (recent.length === 0) return '';
  return `\nEarlier in this conversation, oldest first:\n${recent
    .map((t) => `Q: ${t.question.trim()}\nA: ${t.answer.trim()}`)
    .join('\n')}\n`;
}

export function parseAnswer(text: string): string {
  const json = firstJsonObject(text);
  if (json) {
    try {
      const raw = JSON.parse(json) as { answer?: unknown };
      if (typeof raw.answer === 'string' && raw.answer.trim()) return raw.answer.trim();
    } catch {
      // Fall through: a plain-prose reply is fine here.
    }
  }
  return text.trim();
}

export async function answerQuestion(
  user: ChatUser,
  question: string,
  /** The site the user is looking at, if any — used when the question says "this site". */
  contextProjectId?: string,
  /**
   * What was asked and answered before this, oldest first.
   *
   * Shown to the PLANNER only. A follow-up like "how is it going?" is
   * unanswerable without it, but the step that states figures still sees
   * nothing but the facts retrieved for the question in front of it — so
   * history can change WHICH lookup runs and can never become a number in an
   * answer. That is also why it is safe to take this from the client: the
   * planner's output is a lookup name and scalar arguments, both checked
   * against the catalogue and the user's own permissions.
   */
  history: ChatTurn[] = [],
): Promise<ChatAnswer> {
  const projects = await visibleProjects(user);
  const allowed = new Set(projects.map((p) => p.id));

  const siteList = projects.length
    ? projects.map((p) => `${p.id} = ${p.name} (${p.status.toLowerCase()})`).join('\n')
    : 'This user has no sites.';
  const context = contextProjectId && allowed.has(contextProjectId)
    ? `\nThe user is currently looking at site ${contextProjectId}. "this site", "here" and "today" refer to it.`
    : '';

  const conversation = formatHistory(history);

  // --- Step one: which lookups?
  await recordCall('chat');
  const planText = await generate({
    system: PLANNER_SYSTEM,
    user: `Today is ${new Date().toISOString().slice(0, 10)}.

Catalogue:
${catalogueFor(user)}

Sites this user may ask about:
${siteList}${context}
${conversation}
Question: ${question}`,
    json: true,
    maxTokens: 600,
    noun: 'answer',
  });

  const plan = parsePlan(planText);

  if (plan.decline || plan.lookups.length === 0) {
    return {
      answer:
        plan.decline === 'which site?'
          ? 'Which site do you mean?'
          : `I can't answer that from what the system holds. ${plan.decline ?? ''}`.trim(),
      used: [],
      facts: '',
      sources: [],
    };
  }

  // --- Retrieval. No model involved: this is the app's own code.
  const parts: string[] = [];
  const used: string[] = [];
  const sources: ChatSource[] = [];
  const refusals: string[] = [];

  for (const l of plan.lookups) {
    // A site lookup with no projectId falls back to the site in view.
    const args = { ...l.args };
    if (!args.projectId && contextProjectId) args.projectId = contextProjectId;
    try {
      const result = await runLookup(user, l.name, args, allowed);
      parts.push(result.facts);
      used.push(l.name);
      if (result.source && !sources.some((s) => s.href === result.source!.href)) {
        sources.push(result.source);
      }
    } catch (e) {
      if (e instanceof RetrievalDenied) refusals.push(e.message);
      // Anything else is a bad argument from the planner, e.g. an unparseable
      // date. One failed lookup should not sink an otherwise answerable
      // question, so it is simply left out of the facts.
    }
  }

  if (parts.length === 0) {
    return {
      answer: refusals.length
        ? refusals[0]
        : 'I could not find anything in the system that answers that.',
      used: [],
      facts: '',
      sources: [],
    };
  }

  const facts = parts.join('\n\n');

  // --- Step two: put it in a sentence.
  await recordCall('chat');
  const answerText = await generate({
    system: ANSWER_SYSTEM,
    user: `Facts:\n${facts}\n\nQuestion: ${question}`,
    maxTokens: 800,
    noun: 'answer',
  });

  return { answer: parseAnswer(answerText), used, facts, sources };
}

export { AiError };
