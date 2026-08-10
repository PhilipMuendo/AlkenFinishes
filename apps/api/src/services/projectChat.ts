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

/** How many lookups one question may trigger. Each is a database read, not a model call. */
const MAX_LOOKUPS = 3;

const PLANNER_SYSTEM = `You route a question about a Kenyan construction company to the data that answers it.

Return ONLY JSON: {"lookups":[{"name":"...","args":{...}}],"decline":null}

Rules:
- Choose at most ${MAX_LOOKUPS} lookups from the catalogue, fewest that will answer the question.
- Use ONLY lookup names from the catalogue. Never invent one.
- Pass projectId only from the site list given. Match on the site name in the question. If the question is about a site but names none, and there is exactly one site, use it; otherwise set decline to "which site?".
- Dates are YYYY-MM-DD, months are YYYY-MM.
- If nothing in the catalogue can answer the question, return {"lookups":[],"decline":"<short reason>"}.
- The catalogue reflects what this user is allowed to see. If the question asks for something not in it, decline; do not substitute something else.`;

const ANSWER_SYSTEM = `You answer questions about a Kenyan construction company, for the person running it.

You are given FACTS retrieved from the system. Rules:
- Use ONLY the facts. Never estimate, extrapolate or add a figure that is not there.
- Every number you state must appear in the facts, in the same form. Do not add figures together to make a new one; if the total is not in the facts, do not give a total.
- If the facts do not answer the question, say plainly what is missing. Do not fill the gap.
- Answer in two or three short sentences. Plain English, no preamble, no bullet lists unless you are naming more than three things.
- Money is already formatted as "KES 1,234,000" in the facts. Repeat it exactly as given.
- Do not describe the lookup process or mention "the facts", "the data" or "the system". Just answer.`;

interface Plan {
  lookups: { name: string; args: Record<string, string> }[];
  decline: string | null;
}

/** The planner's reply is untrusted: unknown shapes are dropped, not coerced. */
export function parsePlan(text: string): Plan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('unparseable plan');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

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

export function parseAnswer(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const raw = JSON.parse(text.slice(start, end + 1)) as { answer?: unknown };
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
): Promise<ChatAnswer> {
  const projects = await visibleProjects(user);
  const allowed = new Set(projects.map((p) => p.id));

  const siteList = projects.length
    ? projects.map((p) => `${p.id} = ${p.name} (${p.status.toLowerCase()})`).join('\n')
    : 'This user has no sites.';
  const context = contextProjectId && allowed.has(contextProjectId)
    ? `\nThe user is currently looking at site ${contextProjectId}. "this site", "here" and "today" refer to it.`
    : '';

  // --- Step one: which lookups?
  await recordCall('chat');
  const planText = await generate({
    system: PLANNER_SYSTEM,
    user: `Today is ${new Date().toISOString().slice(0, 10)}.

Catalogue:
${catalogueFor(user)}

Sites this user may ask about:
${siteList}${context}

Question: ${question}`,
    json: true,
    maxTokens: 400,
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
    maxTokens: 500,
    noun: 'answer',
  });

  return { answer: parseAnswer(answerText), used, facts, sources };
}

export { AiError };
