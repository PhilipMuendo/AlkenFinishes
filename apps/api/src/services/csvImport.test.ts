import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { CsvImportError, parsePunchFile } from './csvImport';

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from(rows.join('\r\n'), 'utf-8');
}

test('a punch-log style export (one row per punch) is read', () => {
  const buf = csvBuffer([
    'Employee ID,Time',
    '101,2026-08-24 07:32:00',
    '101,2026-08-24 17:05:00',
  ]);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(rowIssues.length, 0);
  assert.equal(punches.length, 2);
  assert.equal(punches[0].biometricId, '101');
});

test('a timecard style export (date + time in/out columns) becomes two punches per row', () => {
  const buf = csvBuffer([
    'Employee ID,Date,Time In,Time Out',
    '202,2026-08-24,07:30:00,17:00:00',
  ]);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(rowIssues.length, 0);
  assert.equal(punches.length, 2);
  assert.equal(punches[0].timestamp.getHours(), 7);
  assert.equal(punches[1].timestamp.getHours(), 17);
  // Both punches take their calendar date from the Date column, not from
  // whatever date the bare time-only cell happened to parse against.
  assert.equal(punches[0].timestamp.getDate(), 24);
  assert.equal(punches[1].timestamp.getDate(), 24);
});

test('a timecard row with no time-out yet still yields the check-in punch', () => {
  const buf = csvBuffer(['Employee ID,Date,Time In,Time Out', '202,2026-08-24,07:30:00,']);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(rowIssues.length, 0);
  assert.equal(punches.length, 1);
});

test('header aliases are matched case- and spacing-insensitively', () => {
  const buf = csvBuffer(['Badge ID,Punch Time', '303,2026-08-24 08:00:00']);
  const { punches } = parsePunchFile(buf);
  assert.equal(punches[0].biometricId, '303');
});

test('a row missing an employee id is skipped and reported, not silently dropped', () => {
  const buf = csvBuffer(['Employee ID,Time', ',2026-08-24 07:00:00']);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(punches.length, 0);
  assert.equal(rowIssues.length, 1);
  assert.equal(rowIssues[0].row, 2);
});

test('a row with an unreadable timestamp is skipped and reported', () => {
  const buf = csvBuffer(['Employee ID,Time', '101,not-a-date']);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(punches.length, 0);
  assert.match(rowIssues[0].reason, /unreadable timestamp/);
});

test('a row with neither a timestamp nor a time-in column is skipped and reported', () => {
  const buf = csvBuffer(['Employee ID,Notes', '101,hello']);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(punches.length, 0);
  assert.match(rowIssues[0].reason, /no time-in or timestamp/);
});

test('an empty file is rejected outright rather than importing nothing silently', () => {
  const buf = csvBuffer(['Employee ID,Time']);
  assert.throws(() => parsePunchFile(buf), CsvImportError);
});

test('a genuine Excel date cell (not just an ISO string) is read correctly', () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Employee ID', 'Date', 'Time In'],
    [101, new Date(2026, 7, 24), new Date(1899, 11, 30, 7, 30)],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(rowIssues.length, 0);
  assert.equal(punches.length, 1);
  assert.equal(punches[0].biometricId, '101');
  assert.equal(punches[0].timestamp.getHours(), 7);
});
