import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtractionError,
  matchSupplier,
  parseExtraction,
  receiptProvider,
  receiptScanningAvailable,
  suggestFigures,
  verify,
  type ExtractedReceipt,
} from './receiptExtraction';

const NOW = new Date(2026, 7, 9);

const receipt = (over: Partial<ExtractedReceipt> = {}): ExtractedReceipt => ({
  supplierName: 'Bamburi Cement Ltd',
  supplierPin: 'P051234567X',
  invoiceNo: 'INV-4471',
  date: '2026-08-01',
  subtotal: 500_000,
  vatAmount: 80_000,
  total: 580_000,
  taxInvoice: true,
  note: null,
  ...over,
});

const check = (v: ReturnType<typeof verify>, id: string) => v.checks.find((c) => c.id === id)!;

test('a clean receipt passes every check and needs no review', () => {
  const v = verify(receipt(), 16, NOW);
  assert.equal(check(v, 'adds-up').status, 'OK');
  assert.equal(check(v, 'vat-rate').status, 'OK');
  assert.equal(v.needsReview, false);
});

test('a receipt that does not add up is caught, however confident the model was', () => {
  // The error this whole file exists for: a misread digit in the VAT column.
  const v = verify(receipt({ vatAmount: 8_000 }), 16, NOW);
  assert.equal(check(v, 'adds-up').status, 'WARN');
  assert.match(check(v, 'adds-up').message, /508,?000|508000/);
  assert.equal(v.needsReview, true);
});

test('VAT that does not match the rate is flagged even when the total adds up', () => {
  // Internally consistent but wrong: 10% VAT where 16% was expected.
  const v = verify(receipt({ subtotal: 500_000, vatAmount: 50_000, total: 550_000 }), 16, NOW);
  assert.equal(check(v, 'adds-up').status, 'OK', 'the arithmetic is self-consistent');
  assert.equal(check(v, 'vat-rate').status, 'WARN', 'but the rate is not what was expected');
  assert.equal(v.needsReview, true);
});

test('ordinary rounding on a large bill is not treated as an error', () => {
  // 16% of 1,234,567 is 197,530.72; a receipt printing 197,531 is fine.
  const v = verify(
    receipt({ subtotal: 1_234_567, vatAmount: 197_531, total: 1_432_098 }),
    16,
    NOW,
  );
  assert.equal(check(v, 'vat-rate').status, 'OK');
  assert.equal(check(v, 'adds-up').status, 'OK');
});

test('an illegible figure is UNKNOWN, never quietly assumed', () => {
  const v = verify(receipt({ subtotal: null }), 16, NOW);
  assert.equal(check(v, 'adds-up').status, 'UNKNOWN');
  assert.equal(v.needsReview, true, 'anything unchecked still wants a human');
});

test('a future date is flagged, because it is usually a misread year', () => {
  const v = verify(receipt({ date: '2027-01-05' }), 16, NOW);
  assert.equal(check(v, 'date').status, 'WARN');
});

test('a receipt dated today is fine', () => {
  const v = verify(receipt({ date: '2026-08-09' }), 16, NOW);
  assert.equal(
    v.checks.some((c) => c.id === 'date'),
    false,
    'a readable, non-future date raises nothing at all',
  );
});

test('VAT charged without a tax invoice is flagged as a cost, not a credit', () => {
  const v = verify(receipt({ taxInvoice: false }), 16, NOW);
  assert.equal(check(v, 'tax-invoice').status, 'WARN');
  assert.match(check(v, 'tax-invoice').message, /not a credit/);
});

test('a nil total is not a purchase', () => {
  const v = verify(receipt({ subtotal: 0, vatAmount: 0, total: 0 }), 16, NOW);
  assert.equal(check(v, 'total').status, 'WARN');
});

// ---- What lands in the form ----

test('the suggested amount is GROSS, matching how a bill is stored', () => {
  const s = suggestFigures(receipt(), 16);
  assert.equal(s.amount, 580_000, 'what we owe the supplier');
  assert.equal(s.vatAmount, 80_000);
  assert.equal(s.vatRatePct, 16);
});

test('a total and VAT with no subtotal still gives a safe answer', () => {
  const s = suggestFigures(receipt({ subtotal: null }), 16);
  assert.equal(s.amount, 580_000);
  assert.equal(s.vatAmount, 80_000);
  assert.equal(s.vatRatePct, 16, 'the subtotal is implied by the other two');
});

test('a receipt with only a total does NOT have VAT invented for it', () => {
  // The supplier may simply not be registered. Inventing 16% would claim a
  // credit that does not exist, on a return that goes to KRA.
  const s = suggestFigures(receipt({ subtotal: null, vatAmount: null, total: 12_500 }), 16);
  assert.equal(s.amount, 12_500);
  assert.equal(s.vatAmount, null);
  assert.equal(s.vatRatePct, null);
});

test('nothing legible suggests nothing at all', () => {
  const s = suggestFigures(receipt({ subtotal: null, vatAmount: null, total: null }), 16);
  assert.deepEqual(s, { amount: null, vatAmount: null, vatRatePct: null });
});

test('a zero-rated receipt keeps its zero rather than being corrected upwards', () => {
  const s = suggestFigures(receipt({ subtotal: 40_000, vatAmount: 0, total: 40_000 }), 16);
  assert.equal(s.vatAmount, 0);
  assert.equal(s.vatRatePct, 0);
});

// ---- Supplier matching ----

const SUPPLIERS = [
  { id: 's1', name: 'Bamburi Cement Ltd' },
  { id: 's2', name: 'Simba Hardware' },
];

test('a supplier is matched past case, punctuation and company suffixes', () => {
  assert.equal(matchSupplier('BAMBURI CEMENT LTD.', SUPPLIERS)?.id, 's1');
  assert.equal(matchSupplier('bamburi cement', SUPPLIERS)?.id, 's1');
  assert.equal(matchSupplier('Simba', SUPPLIERS)?.id, 's2', 'the suffix is not part of the name');
});

test('a name that is not on the list is left unmatched rather than guessed', () => {
  // Attaching a bill to the wrong merchant misstates what two of them are owed.
  assert.equal(matchSupplier('Bamburi Aggregates', SUPPLIERS), null);
  assert.equal(matchSupplier('Tiles & More', SUPPLIERS), null);
  assert.equal(matchSupplier(null, SUPPLIERS), null);
  assert.equal(matchSupplier('', SUPPLIERS), null);
});

// ---- Parsing the model's reply ----
//
// This is a parser for untrusted input, not a deserialiser: whatever comes
// back is coerced and range-checked before any of it is shown as money.

test('a fenced or chatty reply still parses', () => {
  const e = parseExtraction('```json\n{"total": 1200, "taxInvoice": true}\n```');
  assert.equal(e.total, 1_200);
  assert.equal(e.taxInvoice, true);
});

test('numbers arriving as strings with separators are coerced', () => {
  const e = parseExtraction('{"total": "1,234.50", "subtotal": "1,064.22"}');
  assert.equal(e.total, 1_234.5);
  assert.equal(e.subtotal, 1_064.22);
});

test('an absurd figure is dropped rather than shown as money', () => {
  const e = parseExtraction('{"total": 999999999999}');
  assert.equal(e.total, null, 'a misread is not a purchase in the billions');
});

test('a negative figure is refused', () => {
  assert.equal(parseExtraction('{"total": -500}').total, null);
});

test('the string "null" is null, not a supplier called null', () => {
  const e = parseExtraction('{"supplierName": "null", "invoiceNo": "  "}');
  assert.equal(e.supplierName, null);
  assert.equal(e.invoiceNo, null);
});

test('a malformed date is dropped rather than passed on', () => {
  assert.equal(parseExtraction('{"date": "01/08/2026"}').date, null);
  assert.equal(parseExtraction('{"date": "2026-13-45"}').date, null);
  assert.equal(parseExtraction('{"date": "2026-08-01"}').date, '2026-08-01');
});

test('taxInvoice is only true when it is exactly true', () => {
  assert.equal(parseExtraction('{"taxInvoice": "yes"}').taxInvoice, false);
  assert.equal(parseExtraction('{"taxInvoice": 1}').taxInvoice, false);
  assert.equal(parseExtraction('{"taxInvoice": true}').taxInvoice, true);
});

test('a reply with no JSON at all is an error, not a blank receipt', () => {
  assert.throws(() => parseExtraction('I cannot read this image.'), ExtractionError);
  assert.throws(() => parseExtraction('{ not json'), ExtractionError);
});


// ---- Which service reads the receipts ----
//
// Swapping providers is a configuration change, never a code change. The
// checking above is what makes a cheaper model a safe choice, so choosing one
// must not require touching any of it.

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const keys = ['RECEIPT_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
};

test('no key at all means the feature is simply off', () => {
  withEnv({}, () => {
    assert.equal(receiptProvider(), null);
    assert.equal(receiptScanningAvailable(), false, 'the form still works by hand');
  });
});

test('with only one key, that provider is used without being named', () => {
  withEnv({ GEMINI_API_KEY: 'g' }, () => assert.equal(receiptProvider(), 'gemini'));
  withEnv({ ANTHROPIC_API_KEY: 'a' }, () => assert.equal(receiptProvider(), 'anthropic'));
});

test('with both keys and no preference, the cheaper one wins', () => {
  withEnv({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }, () => {
    assert.equal(receiptProvider(), 'gemini');
  });
});

test('an explicit choice overrides the default, in either direction', () => {
  withEnv({ RECEIPT_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }, () => {
    assert.equal(receiptProvider(), 'anthropic', 'falling back to a better reader stays possible');
  });
  withEnv({ RECEIPT_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }, () => {
    assert.equal(receiptProvider(), 'gemini', 'the name is not case sensitive');
  });
});

test('naming a provider whose key is missing turns the feature off, not on', () => {
  // Better an absent button than a button that fails on every press.
  withEnv({ RECEIPT_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' }, () => {
    assert.equal(receiptProvider(), null);
    assert.equal(receiptScanningAvailable(), false);
  });
});

test("both providers' replies go through the same parser", () => {
  // Gemini returns bare JSON, Anthropic often fences it. One parser, one set
  // of coercions, so the checks downstream cannot tell them apart.
  const gemini = parseExtraction('{"total": 580000, "vatAmount": 80000, "taxInvoice": true}');
  const anthropic = parseExtraction(
    '```json\n{"total": 580000, "vatAmount": 80000, "taxInvoice": true}\n```',
  );
  assert.deepEqual(gemini, anthropic);
});
