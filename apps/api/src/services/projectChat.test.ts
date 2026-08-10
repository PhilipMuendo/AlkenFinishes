import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHistory, parseAnswer, parsePlan } from './projectChat';
import {
  catalogueFor,
  lookupsFor,
  LOOKUPS,
  RetrievalDenied,
  runLookup,
} from './chatRetrieval';

const office = { id: 'u1', role: 'SUPERADMIN' };
const supervisor = { id: 'u2', role: 'SUPERVISOR' };

// ---- What each role is even offered ----

test('a supervisor is never offered a company-money lookup', () => {
  const names = lookupsFor(supervisor).map((l) => l.name);
  assert.ok(!names.includes('who_we_owe'));
  assert.ok(!names.includes('who_owes_us'));
  assert.ok(!names.includes('tax_position'));
  assert.ok(!names.includes('company_overview'));
  assert.ok(!names.includes('site_money'));
});

test('a supervisor still gets the site lookups, which is the point of letting them in', () => {
  const names = lookupsFor(supervisor).map((l) => l.name);
  assert.ok(names.includes('site_status'));
  assert.ok(names.includes('site_day'));
});

test('the office is offered everything', () => {
  assert.equal(lookupsFor(office).length, LOOKUPS.length);
});

test('the catalogue a supervisor sees does not even name the money lookups', () => {
  // Not a nicety: a name in the prompt is something to be talked into asking
  // for. The permission check is separate and enforced regardless, but there is
  // no reason to advertise.
  const cat = catalogueFor(supervisor);
  assert.doesNotMatch(cat, /who_we_owe|tax_position|site_money/);
});

test('every site lookup asks for a projectId in the catalogue', () => {
  const cat = catalogueFor(office);
  for (const l of LOOKUPS.filter((x) => x.scope === 'site')) {
    assert.match(cat, new RegExp(`${l.name}\\([^)]*projectId`));
  }
});

// ---- The catalogue covers the platform -----------------------------------

test('lookup names are unique, or LOOKUP_BY_NAME silently drops one', () => {
  const names = LOOKUPS.map((l) => l.name);
  assert.equal(new Set(names).size, names.length);
});

test('every lookup describes the question it answers', () => {
  for (const l of LOOKUPS) {
    assert.ok(l.description.length > 30, `${l.name} has a thin description`);
  }
});

/**
 * The assistant could once say how many sites there were but not name them,
 * and could not answer "how many workers do we have" at all — the data was in
 * the system, just not reachable. These are the subjects it must be able to
 * reach; the guard is against one quietly going missing again.
 */
test('the catalogue reaches every part of the platform', () => {
  const names = new Set(LOOKUPS.map((l) => l.name));
  for (const required of [
    'sites_list',
    'workforce',
    'site_attendance',
    'site_programme',
    'site_defects',
    'site_safety',
    'site_materials',
    'site_reports',
    'site_documents',
    'site_spend',
    'site_invoices',
    'clients',
    'pipeline',
    'contracts',
    'team',
    'equipment',
    'upcoming',
    'company_operations',
  ]) {
    assert.ok(names.has(required), `no lookup answers for ${required}`);
  }
});

test('a supervisor can ask who is on their sites and which sites those are', () => {
  const names = lookupsFor(supervisor).map((l) => l.name);
  assert.ok(names.includes('sites_list'));
  assert.ok(names.includes('workforce'));
});

test('a supervisor is not offered the commercial lookups', () => {
  const names = lookupsFor(supervisor).map((l) => l.name);
  for (const officeOnly of ['clients', 'pipeline', 'contracts', 'team', 'site_spend', 'site_invoices']) {
    assert.ok(!names.includes(officeOnly), `${officeOnly} was offered to a supervisor`);
  }
});

// ---- Permission is enforced at the lookup, not in the prompt --------------
//
// Each of these is refused before `run` is reached, so none of them touch the
// database. That is the point: a planner talked into asking for something it
// should not have does not get a query, it gets a refusal.

test('an office lookup asked for by a supervisor is refused', async () => {
  await assert.rejects(
    () => runLookup(supervisor, 'who_we_owe', {}, new Set()),
    RetrievalDenied,
  );
});

test('a site lookup on a site the user cannot see is refused', async () => {
  await assert.rejects(
    () => runLookup(supervisor, 'site_status', { projectId: 'not-mine' }, new Set(['mine'])),
    RetrievalDenied,
  );
});

test('a site lookup with no site is refused rather than run across all of them', async () => {
  await assert.rejects(
    () => runLookup(supervisor, 'site_defects', {}, new Set(['mine'])),
    RetrievalDenied,
  );
});

test('an invented lookup name is refused', async () => {
  await assert.rejects(
    () => runLookup(office, 'drop_everything', {}, new Set()),
    RetrievalDenied,
  );
});

test('a projectId smuggled onto an office lookup is still checked', async () => {
  // site_spend is office-scoped, so the scope test passes — but the site it
  // names must still be one this user can see.
  await assert.rejects(
    () => runLookup(office, 'site_spend', { projectId: 'somewhere-else' }, new Set(['mine'])),
    RetrievalDenied,
  );
});

// ---- The planner's reply is untrusted ----

test('a clean plan parses', () => {
  const p = parsePlan('{"lookups":[{"name":"who_we_owe","args":{}}],"decline":null}');
  assert.equal(p.lookups.length, 1);
  assert.equal(p.lookups[0].name, 'who_we_owe');
  assert.equal(p.decline, null);
});

test('a fenced plan still parses', () => {
  const p = parsePlan('```json\n{"lookups":[{"name":"site_status","args":{"projectId":"p1"}}]}\n```');
  assert.equal(p.lookups[0].args.projectId, 'p1');
});

test('a question cannot fan out into an unbounded number of reads', () => {
  const many = Array.from({ length: 9 }, () => ({ name: 'site_status', args: {} }));
  const p = parsePlan(JSON.stringify({ lookups: many }));
  assert.ok(p.lookups.length <= 4, `${p.lookups.length} lookups`);
});

test('a nameless entry is dropped rather than run', () => {
  const p = parsePlan('{"lookups":[{"args":{}},{"name":"who_we_owe","args":{}}]}');
  assert.equal(p.lookups.length, 1);
  assert.equal(p.lookups[0].name, 'who_we_owe');
});

test('non-scalar arguments are dropped, not stringified into a query', () => {
  const p = parsePlan(
    '{"lookups":[{"name":"site_day","args":{"projectId":"p1","date":{"$gt":"x"},"n":3}}]}',
  );
  assert.equal(p.lookups[0].args.projectId, 'p1');
  assert.equal(p.lookups[0].args.date, undefined);
  assert.equal(p.lookups[0].args.n, '3');
});

test('a decline is carried through', () => {
  const p = parsePlan('{"lookups":[],"decline":"which site?"}');
  assert.equal(p.decline, 'which site?');
  assert.equal(p.lookups.length, 0);
});

test('an empty decline string counts as no decline', () => {
  assert.equal(parsePlan('{"lookups":[],"decline":"   "}').decline, null);
});

test('a reply with no JSON is an error, not an empty plan that silently answers nothing', () => {
  assert.throws(() => parsePlan('I think you should look at the payables page.'));
});

// A real failure: the model answered with the plan and then a second object,
// and taking first-brace-to-last-brace swallowed both and parsed neither, so a
// perfectly good plan was thrown away.
test('a plan followed by more output still parses', () => {
  const p = parsePlan('{"lookups":[{"name":"sites_list","args":{}}],"decline":null}\n{"note":"hope that helps"}');
  assert.equal(p.lookups.length, 1);
  assert.equal(p.lookups[0].name, 'sites_list');
});

test('a plan followed by prose still parses', () => {
  const p = parsePlan('{"lookups":[{"name":"workforce","args":{}}]}\n\nThis lists the fundis {and their trades}.');
  assert.equal(p.lookups[0].name, 'workforce');
});

test('nested objects are not cut short by the first closing brace', () => {
  const p = parsePlan('{"lookups":[{"name":"site_day","args":{"date":"2026-08-10"}}],"decline":null}');
  assert.equal(p.lookups[0].args.date, '2026-08-10');
});

test('a brace inside a string does not end the object early', () => {
  const p = parsePlan('{"decline":"which site? {unclear}","lookups":[]}');
  assert.equal(p.decline, 'which site? {unclear}');
});

// ---- Follow-up questions ----
//
// History reaches the PLANNER only, so it can change which lookup runs and
// can never become a figure in an answer. These pin the bound and the shape.

test('no history is no conversation block at all, not an empty heading', () => {
  assert.equal(formatHistory([]), '');
  assert.equal(formatHistory([{ question: '  ', answer: '  ' }]), '');
});

test('a turn that never got an answer is not sent as context', () => {
  const out = formatHistory([
    { question: 'Which sites are active?', answer: '' },
    { question: 'How many workers?', answer: 'One.' },
  ]);
  assert.doesNotMatch(out, /Which sites are active/);
  assert.match(out, /How many workers/);
});

test('a long conversation is trimmed to the most recent turns', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    question: `question ${i}`,
    answer: `answer ${i}`,
  }));
  const out = formatHistory(many);
  // The oldest must be gone or the prompt grows without bound all afternoon.
  assert.doesNotMatch(out, /question 0\b/);
  assert.match(out, /question 11/);
  assert.ok(out.split('Q: ').length - 1 <= 4);
});

test('the most recent turn is last, so "it" refers to the nearest subject', () => {
  const out = formatHistory([
    { question: 'first', answer: 'a' },
    { question: 'second', answer: 'b' },
  ]);
  assert.ok(out.indexOf('first') < out.indexOf('second'));
});

// ---- The answer ----

test('a JSON answer is unwrapped', () => {
  assert.equal(parseAnswer('{"answer":"You are owed KES 1,200,000."}'), 'You are owed KES 1,200,000.');
});

test('a prose answer is taken as it stands', () => {
  assert.equal(parseAnswer('  You are owed KES 1,200,000.  '), 'You are owed KES 1,200,000.');
});

test('a JSON object with no answer field falls back to the raw text rather than going blank', () => {
  const out = parseAnswer('{"notes":"unsure"}');
  assert.ok(out.length > 0);
});
