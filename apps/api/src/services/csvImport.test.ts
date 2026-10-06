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

// ---- "All Report" workbook from the generic face/fingerprint terminals ----

/** A workbook shaped like the terminal's USB export: several analysis sheets plus "Attendance Logs". */
function allReportBuffer(range: string, blocks: { id: string; name: string; days: string[]; punches: string[] }[]): Buffer {
  const logs: string[][] = [['Attendance Logs'], ['Date', '', range]];
  for (const b of blocks) {
    logs.push(['ID', '', b.id, '', '', '', '', '', '', 'Name', '', b.name]);
    logs.push(b.days);
    logs.push(b.days.map(() => 'Mon'));
    logs.push(b.punches);
  }
  const workbook = XLSX.utils.book_new();
  // The first sheet is deliberately not the punch data, as in the real export.
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Schedule information sheet'], ['ID', 'Name']]), 'Schedule information sheet');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(logs), 'Attendance Logs');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Abnormal'], ['1', 'x', 'Missed']]), 'Abnormal');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('an All Report export is read from its Attendance Logs sheet, one punch per time in a cell', () => {
  const buf = allReportBuffer('2026-10-01 ~ 2026-10-02', [
    { id: '1', name: 'Test One', days: ['1', '2'], punches: ['', '13:41\n14:40'] },
    { id: '2', name: 'Test Two', days: ['1', '2'], punches: ['07:30\n17:05', ''] },
  ]);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(rowIssues.length, 0);
  assert.equal(punches.length, 4);
  const one = punches.filter((p) => p.biometricId === '1');
  assert.deepEqual(one.map((p) => [p.timestamp.getDate(), p.timestamp.getHours(), p.timestamp.getMinutes()]), [
    [2, 13, 41],
    [2, 14, 40],
  ]);
  const two = punches.filter((p) => p.biometricId === '2');
  assert.deepEqual(two.map((p) => [p.timestamp.getDate(), p.timestamp.getHours(), p.timestamp.getMinutes()]), [
    [1, 7, 30],
    [1, 17, 5],
  ]);
});

test('an All Report range that spans two months puts each day in the right month', () => {
  const buf = allReportBuffer('2026-09-29 ~ 2026-10-02', [
    { id: '7', name: 'Test Seven', days: ['29', '30', '1', '2'], punches: ['07:00', '', '', '08:00'] },
  ]);
  const { punches } = parsePunchFile(buf);
  assert.deepEqual(
    punches.map((p) => [p.timestamp.getMonth() + 1, p.timestamp.getDate()]),
    [
      [9, 29],
      [10, 2],
    ],
  );
});

test('"Missed" markers and an empty report import nothing and do not error', () => {
  const buf = allReportBuffer('2026-10-01 ~ 2026-10-02', [
    { id: '1', name: 'Test One', days: ['1', '2'], punches: ['Missed', ''] },
  ]);
  const { punches, rowIssues } = parsePunchFile(buf);
  assert.equal(punches.length, 0);
  assert.equal(rowIssues.length, 0);
});

test('an All Report without a date range is rejected rather than guessing the month', () => {
  const buf = allReportBuffer('no range here', [{ id: '1', name: 'Test One', days: ['1'], punches: ['07:00'] }]);
  assert.throws(() => parsePunchFile(buf), CsvImportError);
});
