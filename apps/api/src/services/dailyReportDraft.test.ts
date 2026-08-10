import test from 'node:test';
import assert from 'node:assert/strict';
import { factsFor, parseDraft, type DaySummary } from './dailyReportDraft';

const day = (over: Partial<DaySummary> = {}): DaySummary => ({
  date: new Date(2026, 7, 10),
  projectName: 'Kilimani School',
  workersPresent: 6,
  workerNames: ['Otieno', 'Wanjiru', 'Kamau'],
  trades: ['Painter', 'Mason'],
  hoursWorked: 48,
  tasksCompleted: ['Second coat to block B'],
  tasksInProgress: ['Skirting to corridor'],
  snagsRaised: [{ title: 'Paint run on window reveal', severity: 'MEDIUM' }],
  snagsResolved: ['Cracked tile at entrance'],
  materialsDelivered: ['20 bags Cement'],
  safetyIncidents: [],
  toolsDelivered: [],
  empty: false,
  ...over,
});

test('the facts carry what the day actually recorded', () => {
  const f = factsFor(day());
  assert.match(f, /Kilimani School/);
  assert.match(f, /Workers on site: 6/);
  assert.match(f, /Second coat to block B/);
  assert.match(f, /Skirting to corridor/);
  assert.match(f, /20 bags Cement/);
  assert.match(f, /Paint run on window reveal \(medium\)/);
  assert.match(f, /Cracked tile at entrance/);
});

test('a section with nothing in it is left out rather than stated as none', () => {
  // Padding the facts with "Safety: none" invites the model to write a
  // sentence about nothing having happened.
  const f = factsFor(day({ safetyIncidents: [], toolsDelivered: [], materialsDelivered: [] }));
  assert.doesNotMatch(f, /Safety:/);
  assert.doesNotMatch(f, /Equipment arrived:/);
  assert.doesNotMatch(f, /Materials delivered:/);
});

test('a day with nobody on site does not claim a workforce', () => {
  const f = factsFor(day({ workersPresent: 0, workerNames: [], trades: [] }));
  assert.doesNotMatch(f, /Workers on site/);
});

test('safety wording is readable rather than an enum', () => {
  const f = factsFor(
    day({ safetyIncidents: [{ severity: 'NEAR_MISS', description: 'Scaffold board loose' }] }),
  );
  assert.match(f, /near miss — Scaffold board loose/);
});

// ---- Parsing the reply ----

test('a clean reply parses into the four fields', () => {
  const d = parseDraft(
    '{"workCompleted":"Second coat completed to block B.","materialsUsed":"20 bags of cement.","challenges":null,"safetyNotes":null}',
  );
  assert.equal(d.workCompleted, 'Second coat completed to block B.');
  assert.equal(d.materialsUsed, '20 bags of cement.');
  assert.equal(d.challenges, null);
  assert.equal(d.safetyNotes, null);
});

test('a fenced reply still parses', () => {
  const d = parseDraft('```json\n{"workCompleted":"Skirting continued."}\n```');
  assert.equal(d.workCompleted, 'Skirting continued.');
});

test('the string "null" and blanks become null, not text in the form', () => {
  const d = parseDraft('{"workCompleted":"Work done.","challenges":"null","safetyNotes":"   "}');
  assert.equal(d.challenges, null);
  assert.equal(d.safetyNotes, null);
});

test('a non-string where prose belongs is dropped', () => {
  const d = parseDraft('{"workCompleted":"Done.","materialsUsed":42,"challenges":{"a":1}}');
  assert.equal(d.materialsUsed, null);
  assert.equal(d.challenges, null);
});

test('a missing workCompleted comes back empty so the form stays required', () => {
  // Better an empty required field the supervisor must fill than a
  // confident-looking sentence nobody wrote.
  const d = parseDraft('{"challenges":"Rain stopped work."}');
  assert.equal(d.workCompleted, '');
});

test('a reply with no JSON is an error, not a blank report', () => {
  assert.throws(() => parseDraft('I could not write this.'));
});
