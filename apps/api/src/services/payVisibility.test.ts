import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOffice,
  visibleAttendance,
  visibleAttendanceList,
  visibleWorker,
  visibleWorkers,
} from './payVisibility';

const worker = () => ({ id: 'w1', name: 'Otieno', trade: 'Painter', hourlyRate: '250' });
const record = () => ({
  id: 'a1',
  date: '2026-08-10',
  hoursWorked: '8',
  labourCost: '2000',
  worker: worker(),
});

test('the office sees the rate', () => {
  assert.equal(visibleWorker(worker(), 'SUPERADMIN').hourlyRate, '250');
});

test('a supervisor does not', () => {
  const w = visibleWorker(worker(), 'SUPERVISOR');
  assert.equal('hourlyRate' in w, false);
});

test('the rest of the fundi survives the strip', () => {
  const w = visibleWorker(worker(), 'SUPERVISOR');
  assert.equal(w.id, 'w1');
  assert.equal(w.name, 'Otieno');
  assert.equal(w.trade, 'Painter');
});

test('a list is stripped row by row', () => {
  const list = visibleWorkers([worker(), worker()], 'SUPERVISOR');
  assert.equal(list.length, 2);
  assert.ok(list.every((w) => !('hourlyRate' in w)));
});

test('labour cost goes too, because cost over hours is the rate', () => {
  // The point of the whole module: stripping the rate while leaving the
  // derived figure on screen would look like a boundary and not be one.
  const r = visibleAttendance(record(), 'SUPERVISOR');
  assert.equal('labourCost' in r, false);
});

test('the nested worker on an attendance record is stripped as well', () => {
  const r = visibleAttendance(record(), 'SUPERVISOR');
  assert.equal('hourlyRate' in (r.worker ?? {}), false);
});

test('a supervisor still sees who was there and for how long', () => {
  const r = visibleAttendance(record(), 'SUPERVISOR');
  assert.equal(r.hoursWorked, '8');
  assert.equal(r.date, '2026-08-10');
  assert.equal(r.worker?.name, 'Otieno');
});

test('the office sees the whole record', () => {
  const r = visibleAttendance(record(), 'SUPERADMIN');
  assert.equal(r.labourCost, '2000');
  assert.equal(r.worker?.hourlyRate, '250');
});

test('a record with no worker attached does not throw', () => {
  const r = visibleAttendance({ id: 'a1', labourCost: '10', worker: null }, 'SUPERVISOR');
  assert.equal('labourCost' in r, false);
  assert.equal(r.worker, null);
});

test('an unrecognised role is treated as not-the-office', () => {
  // Fail closed: a role this module has not heard of does not get pay data.
  assert.equal(isOffice('CLIENT'), false);
  assert.equal('hourlyRate' in visibleWorker(worker(), 'CLIENT'), false);
});

test('stripping does not mutate the original', () => {
  const original = worker();
  visibleWorker(original, 'SUPERVISOR');
  assert.equal(original.hourlyRate, '250');
});

test('an empty list is fine', () => {
  assert.deepEqual(visibleWorkers([], 'SUPERVISOR'), []);
  assert.deepEqual(visibleAttendanceList([], 'SUPERVISOR'), []);
});
