import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoDate, nowLocalDateTime, parseISODate, todayISO } from './format';

/**
 * These look trivial and are not.
 *
 * Every one of them previously went through `toISOString().slice(0, 10)`, which
 * is UTC. Run east of Greenwich — which is where this app runs — a Date built
 * at local midnight is the previous evening in UTC, so the payroll period
 * defaulted to the 31st of the month before, and the diary date defaulted to
 * yesterday for the first three hours of every day.
 *
 * The tests below are timezone-independent: they build dates in local time and
 * assert the local calendar answer, which is the whole point.
 */

test('a date built at local midnight formats as that same day', () => {
  // The exact case that broke payroll: the first of the month, at 00:00 local.
  const firstOfAugust = new Date(2026, 7, 1);
  assert.equal(isoDate(firstOfAugust), '2026-08-01');
});

test('the last day of a month formats as itself, not the day before', () => {
  const lastOfAugust = new Date(2026, 8, 0); // day 0 of September
  assert.equal(isoDate(lastOfAugust), '2026-08-31');
});

test('single-digit months and days are padded', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('a date late in the local evening still formats as that day', () => {
  // 23:30 local is already tomorrow in UTC anywhere east of about UTC+1.
  assert.equal(isoDate(new Date(2026, 7, 10, 23, 30)), '2026-08-10');
});

test('a date early in the local morning still formats as that day', () => {
  // 00:30 local is still yesterday in UTC anywhere west of it.
  assert.equal(isoDate(new Date(2026, 7, 10, 0, 30)), '2026-08-10');
});

test('parsing a date string round-trips through formatting', () => {
  for (const iso of ['2026-01-01', '2026-08-10', '2026-12-31', '2024-02-29']) {
    assert.equal(isoDate(parseISODate(iso)), iso);
  }
});

test('parsing reads the local calendar date, not a UTC instant', () => {
  const d = parseISODate('2026-08-10');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 10);
});

test('adding days crosses a month boundary correctly', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02');
});

test('adding days crosses a year boundary correctly', () => {
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
});

test('adding days handles a leap day', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
});

test('adding zero days is the identity', () => {
  assert.equal(addDays('2026-08-10', 0), '2026-08-10');
});

test('adding negative days goes backwards', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('today matches the local calendar', () => {
  const now = new Date();
  assert.equal(todayISO(), isoDate(now));
  assert.equal(todayISO().length, 10);
});

test('a datetime-local value carries local wall-clock time', () => {
  const v = nowLocalDateTime();
  assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  // It must agree with the local clock, not with UTC.
  const now = new Date();
  assert.equal(v.slice(0, 10), isoDate(now));
  assert.equal(v.slice(11, 13), String(now.getHours()).padStart(2, '0'));
});
