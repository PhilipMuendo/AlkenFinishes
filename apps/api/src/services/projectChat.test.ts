import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer, parsePlan } from './projectChat';
import { catalogueFor, lookupsFor, LOOKUPS } from './chatRetrieval';

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

test('no more than three lookups run off one question', () => {
  const many = Array.from({ length: 9 }, () => ({ name: 'site_status', args: {} }));
  const p = parsePlan(JSON.stringify({ lookups: many }));
  assert.equal(p.lookups.length, 3);
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
