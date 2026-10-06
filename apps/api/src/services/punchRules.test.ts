import test from 'node:test';
import assert from 'node:assert/strict';
import { localDayStart, parseDeviceTimestamp, resolvePunchSite } from './punchRules';

const NBO = 'Africa/Nairobi'; // UTC+3, no DST

test('a device stamp is read as site-local time, not UTC', () => {
  // 07:30 in Nairobi is 04:30Z. Reading it as UTC (the old bug) made every
  // device check-in render three hours late in the app.
  assert.equal(parseDeviceTimestamp('2026-09-28 07:30:00', NBO)?.toISOString(), '2026-09-28T04:30:00.000Z');
});

test('seconds are optional and a T separator is accepted', () => {
  assert.equal(parseDeviceTimestamp('2026-09-28T17:00', NBO)?.toISOString(), '2026-09-28T14:00:00.000Z');
});

test('a punch just after local midnight lands on the previous UTC day instant', () => {
  assert.equal(parseDeviceTimestamp('2026-09-24 00:30:00', NBO)?.toISOString(), '2026-09-23T21:30:00.000Z');
});

test('a zone with DST resolves the offset at the punch instant', () => {
  // London: BST (UTC+1) in summer, GMT (UTC+0) in winter.
  assert.equal(parseDeviceTimestamp('2026-07-01 12:00:00', 'Europe/London')?.toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(parseDeviceTimestamp('2026-01-01 12:00:00', 'Europe/London')?.toISOString(), '2026-01-01T12:00:00.000Z');
});

test('garbage and impossible calendar times are rejected', () => {
  for (const bad of ['', 'garbage', 'not-a-date', '2026-13-01 07:00:00', '2026-02-31 07:00:00', '2026-09-28 25:00:00']) {
    assert.equal(parseDeviceTimestamp(bad, NBO), null, bad);
  }
});

test('the site day is the local calendar day, not the UTC day', () => {
  // 00:30 Nairobi on the 24th is still the 23rd in UTC — it must file under the 24th.
  const ts = parseDeviceTimestamp('2026-09-24 00:30:00', NBO)!;
  assert.equal(localDayStart(ts, NBO).toISOString(), '2026-09-24T00:00:00.000Z');
  // 23:30 Nairobi on the 24th is 20:30Z the same UTC day.
  const late = parseDeviceTimestamp('2026-09-24 23:30:00', NBO)!;
  assert.equal(localDayStart(late, NBO).toISOString(), '2026-09-24T00:00:00.000Z');
});

test('a worker assigned to the device site is placed there', () => {
  assert.deepEqual(resolvePunchSite({ projectId: 'A' }, 'A'), { ok: true, projectId: 'A' });
});

test('a worker from another site punching on a bound device is wrong_site', () => {
  assert.deepEqual(resolvePunchSite({ projectId: 'A' }, 'B'), { ok: false, reason: 'wrong_site' });
});

test('an unassigned worker is no_assignment even on a site-bound device', () => {
  assert.deepEqual(resolvePunchSite({ projectId: 'A' }, undefined), { ok: false, reason: 'no_assignment' });
  assert.deepEqual(resolvePunchSite({ projectId: 'A' }, null), { ok: false, reason: 'no_assignment' });
});

test('an unbound device places a worker at their own assignment', () => {
  assert.deepEqual(resolvePunchSite({ projectId: null }, 'B'), { ok: true, projectId: 'B' });
  assert.deepEqual(resolvePunchSite({ projectId: null }, undefined), { ok: false, reason: 'no_assignment' });
});
