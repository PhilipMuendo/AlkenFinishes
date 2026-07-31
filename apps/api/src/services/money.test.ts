import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, toCents } from './money';

test('amountInWords: whole shillings', () => {
  assert.equal(amountInWords(toCents(0)), 'Zero Shillings Only');
  assert.equal(amountInWords(toCents(1)), 'One Shilling Only');
  assert.equal(amountInWords(toCents(15)), 'Fifteen Shillings Only');
  assert.equal(amountInWords(toCents(42)), 'Forty Two Shillings Only');
  assert.equal(amountInWords(toCents(100)), 'One Hundred Shillings Only');
  assert.equal(amountInWords(toCents(101)), 'One Hundred and One Shillings Only');
  assert.equal(amountInWords(toCents(999)), 'Nine Hundred and Ninety Nine Shillings Only');
});

test('amountInWords: scales', () => {
  assert.equal(amountInWords(toCents(1_000)), 'One Thousand Shillings Only');
  assert.equal(
    amountInWords(toCents(1_234_567)),
    'One Million Two Hundred and Thirty Four Thousand Five Hundred and Sixty Seven Shillings Only',
  );
  // The gap case: no hundreds/tens between the scale words.
  assert.equal(amountInWords(toCents(1_000_005)), 'One Million Five Shillings Only');
  assert.equal(amountInWords(toCents(2_000_000)), 'Two Million Shillings Only');
});

test('amountInWords: cents', () => {
  assert.equal(amountInWords(toCents(1.5)), 'One Shilling and Fifty Cents Only');
  assert.equal(amountInWords(toCents(0.01)), 'Zero Shillings and One Cent Only');
  assert.equal(
    amountInWords(toCents(157_240.75)),
    'One Hundred and Fifty Seven Thousand Two Hundred and Forty Shillings and Seventy Five Cents Only',
  );
});

test('amountInWords: reads the same cents the figures are printed from', () => {
  // 0.1 + 0.2 in floating point is 0.30000000000000004; going through cents
  // means the words and the numerals cannot drift apart.
  const cents = toCents(0.1) + toCents(0.2);
  assert.equal(cents, 30);
  assert.equal(amountInWords(cents), 'Zero Shillings and Thirty Cents Only');
});

test('amountInWords: negative', () => {
  assert.equal(amountInWords(toCents(-5)), 'Minus Five Shillings Only');
});
