import test from 'node:test';
import assert from 'node:assert/strict';
import { factsFor, parseWeeklyDraft, type WeekSummary } from './weeklyReportDraft';

const week = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  weekEnding: new Date(2026, 7, 16),
  from: new Date(2026, 7, 10),
  to: new Date(2026, 7, 16),
  projectName: 'Kilimani School',
  daysReported: 2,
  dailyEntries: [
    {
      date: new Date(2026, 7, 10),
      workCompleted: 'Second coat to block B.',
      workersPresent: 6,
      materialsUsed: '20 bags Cement',
      challenges: null,
      delays: null,
      safetyNotes: null,
    },
    {
      date: new Date(2026, 7, 12),
      workCompleted: 'Skirting continued in corridor.',
      workersPresent: 5,
      materialsUsed: null,
      challenges: 'Short by 2 masons.',
      delays: 'Rain in the afternoon.',
      safetyNotes: null,
    },
  ],
  tasksCompleted: ['Second coat to block B'],
  snagsRaised: 1,
  snagsResolved: 1,
  safetyIncidents: [],
  empty: false,
  ...over,
});

test('the facts carry each daily entry actually filed', () => {
  const f = factsFor(week());
  assert.match(f, /Kilimani School/);
  assert.match(f, /2 of 7 days had a diary entry filed/);
  assert.match(f, /Second coat to block B/);
  assert.match(f, /Skirting continued in corridor/);
  assert.match(f, /Short by 2 masons/);
  assert.match(f, /Rain in the afternoon/);
});

test('grounded counts appear alongside the daily prose', () => {
  const f = factsFor(week());
  assert.match(f, /Tasks marked done this week: Second coat to block B/);
  assert.match(f, /1 raised, 1 resolved/);
});

test('a week with no defects or safety incidents says nothing about them', () => {
  const f = factsFor(week({ snagsRaised: 0, snagsResolved: 0, safetyIncidents: [] }));
  assert.doesNotMatch(f, /Defects:/);
  assert.doesNotMatch(f, /Safety incidents:/);
});

test('safety wording is readable rather than an enum', () => {
  const f = factsFor(
    week({ safetyIncidents: [{ severity: 'NEAR_MISS', description: 'Scaffold board loose' }] }),
  );
  assert.match(f, /near miss — Scaffold board loose/);
});

// ---- Parsing the reply ----

test('a clean reply parses into the four fields', () => {
  const d = parseWeeklyDraft(
    '{"summary":"Steady progress on block B.","milestones":"Second coat finished.","issues":"Short-staffed mid-week.","nextWeekPlan":null}',
  );
  assert.equal(d.summary, 'Steady progress on block B.');
  assert.equal(d.milestones, 'Second coat finished.');
  assert.equal(d.issues, 'Short-staffed mid-week.');
  assert.equal(d.nextWeekPlan, null);
});

test('a fenced reply still parses', () => {
  const d = parseWeeklyDraft('```json\n{"summary":"Week summary."}\n```');
  assert.equal(d.summary, 'Week summary.');
});

test('the string "null" and blanks become null, not text in the form', () => {
  const d = parseWeeklyDraft('{"summary":"Done.","issues":"null","nextWeekPlan":"   "}');
  assert.equal(d.issues, null);
  assert.equal(d.nextWeekPlan, null);
});

test('a non-string where prose belongs is dropped', () => {
  const d = parseWeeklyDraft('{"summary":"Done.","milestones":42,"issues":{"a":1}}');
  assert.equal(d.milestones, null);
  assert.equal(d.issues, null);
});

test('a missing summary comes back empty so the form stays required', () => {
  const d = parseWeeklyDraft('{"issues":"Rain stopped work."}');
  assert.equal(d.summary, '');
});

test('a reply with no JSON is an error, not a blank report', () => {
  assert.throws(() => parseWeeklyDraft('I could not write this.'));
});
