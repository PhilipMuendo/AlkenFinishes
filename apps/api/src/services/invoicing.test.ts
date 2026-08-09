import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  aggregateSettledCents,
  agingBucket,
  computeInvoiceTotals,
  deriveStatus,
  invoiceBalanceCents,
  paymentSettledCents,
} from './invoicing';
import { lineTotalCents, pctOfCents, toCents } from './money';

/**
 * Run with:  npm test -w @alken/api
 *
 * These cover the three ordering traps in computeInvoiceTotals plus the
 * status/aging derivations. Getting any of them wrong silently corrupts every
 * invoice the business issues, so they are asserted directly rather than
 * inferred from an end-to-end run.
 */

describe('money primitives', () => {
  it('rounds half-up to cents', () => {
    assert.equal(toCents('0.005'), 1);
    assert.equal(toCents('1.114'), 111);
    assert.equal(toCents('1.115'), 112);
  });

  it('avoids binary float drift', () => {
    assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3'));
  });

  it('computes a percentage in whole cents', () => {
    assert.equal(pctOfCents(100_000, 16), 16_000);
    assert.equal(pctOfCents(0, 16), 0);
    assert.equal(pctOfCents(100_000, 0), 0);
  });
});

describe('trap 1: rounds per line, then sums', () => {
  it('makes the printed line column add up to the printed subtotal', () => {
    // 3 x 0.005 — sum-then-round gives 2 cents (0.015 -> 0.02), round-per-line
    // gives 3. The invoice prints the line column, so the subtotal must agree
    // with the line column, not with a more "accurate" total.
    const lines = [
      { quantity: 1, unitPrice: '0.005' },
      { quantity: 1, unitPrice: '0.005' },
      { quantity: 1, unitPrice: '0.005' },
    ];
    const t = computeInvoiceTotals({ lines, vatRatePct: 0, retentionRatePct: 0 });
    assert.deepEqual(t.lineTotalsCents, [1, 1, 1]);
    assert.equal(t.subtotalCents, 3);
    assert.equal(
      t.subtotalCents,
      t.lineTotalsCents.reduce((a, b) => a + b, 0),
      'subtotal must equal the sum of the printed line totals',
    );
  });

  it('handles 3dp quantities', () => {
    assert.equal(lineTotalCents('12.5', '450'), 562_500);
    assert.equal(lineTotalCents('0.75', '1200'), 90_000);
  });
});

describe('trap 2: VAT once on the subtotal, not per line', () => {
  it('does not lose VAT to per-line rounding', () => {
    // Per line, 16% of 0.03 rounds to 0. Summed that is 0 — but 16% of the
    // 0.09 subtotal is 1 cent. The single printed "VAT @ 16%" line must match.
    const lines = [
      { quantity: 1, unitPrice: '0.03' },
      { quantity: 1, unitPrice: '0.03' },
      { quantity: 1, unitPrice: '0.03' },
    ];
    const t = computeInvoiceTotals({ lines, vatRatePct: 16, retentionRatePct: 0 });
    assert.equal(t.subtotalCents, 9);
    assert.equal(t.vatAmountCents, 1);
    assert.notEqual(t.vatAmountCents, 0, 'per-line VAT summed would have been 0');
  });

  it('excludes zero-rated lines from VAT but not from the subtotal', () => {
    const t = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: '1000' },
        { quantity: 1, unitPrice: '500', taxable: false },
      ],
      vatRatePct: 16,
      retentionRatePct: 0,
    });
    assert.equal(t.subtotalCents, 150_000);
    assert.equal(t.vatAmountCents, 16_000, 'VAT only on the 1,000 taxable line');
    assert.equal(t.grossTotalCents, 166_000);
  });

  it('suppresses VAT entirely at a 0% rate', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: '1000' }],
      vatRatePct: 0,
      retentionRatePct: 0,
    });
    assert.equal(t.vatAmountCents, 0);
    assert.equal(t.grossTotalCents, t.subtotalCents);
  });
});

describe('trap 3: retention is withheld on the EX-VAT subtotal', () => {
  it('does not retain a slice of the VAT owed to KRA', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: '1000000' }],
      vatRatePct: 16,
      retentionRatePct: 5,
    });
    assert.equal(t.subtotalCents, 100_000_000); // 1,000,000.00
    assert.equal(t.vatAmountCents, 16_000_000); //   160,000.00
    assert.equal(t.grossTotalCents, 116_000_000); // 1,160,000.00

    // 5% of the 1,000,000 subtotal = 50,000 — NOT 5% of 1,160,000 (58,000).
    assert.equal(t.retentionAmountCents, 5_000_000);
    assert.notEqual(t.retentionAmountCents, 5_800_000, 'must not retain against gross');
    assert.equal(t.netPayableCents, 111_000_000); // 1,110,000.00
  });

  it('leaves net payable equal to gross when no retention applies', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 2, unitPrice: '250' }],
      vatRatePct: 16,
      retentionRatePct: 0,
    });
    assert.equal(t.netPayableCents, t.grossTotalCents);
  });
});

describe('the canonical fixture', () => {
  it('reproduces the reference invoice exactly', () => {
    const t = computeInvoiceTotals({
      lines: [
        { quantity: 120, unitPrice: 450 }, // skimming        54,000
        { quantity: 200, unitPrice: 300 }, // painting        60,000
        { quantity: 1, unitPrice: 25000, taxable: false }, // scaffolding 25,000 zero-rated
      ],
      vatRatePct: 16,
      retentionRatePct: 5,
    });
    assert.equal(t.subtotalCents, 13_900_000); // 139,000.00
    assert.equal(t.vatAmountCents, 1_824_000); //  18,240.00 (16% of 114,000)
    assert.equal(t.grossTotalCents, 15_724_000); // 157,240.00
    assert.equal(t.retentionAmountCents, 695_000); //   6,950.00 (5% of 139,000)
    assert.equal(t.netPayableCents, 15_029_000); // 150,290.00
  });
});

describe('VAT-inclusive pricing', () => {
  it('derives VAT by subtraction so the parts reconcile to the quoted figure', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: '1160' }],
      vatRatePct: 16,
      retentionRatePct: 0,
      vatInclusive: true,
    });
    assert.equal(t.grossTotalCents, 116_000, 'gross must equal what was quoted');
    assert.equal(t.subtotalCents, 100_000);
    assert.equal(t.vatAmountCents, 16_000);
    assert.equal(t.subtotalCents + t.vatAmountCents, t.grossTotalCents);
  });

  it('reconciles even where the division does not land on a whole cent', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: '100' }],
      vatRatePct: 16,
      retentionRatePct: 0,
      vatInclusive: true,
    });
    assert.equal(t.grossTotalCents, 10_000);
    assert.equal(t.subtotalCents + t.vatAmountCents, t.grossTotalCents);
  });
});

describe('balances and status', () => {
  it('strikes the balance against net payable, not gross', () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: '1000000' }],
      vatRatePct: 16,
      retentionRatePct: 5,
    });
    assert.equal(invoiceBalanceCents(t.netPayableCents, t.netPayableCents), 0);
  });

  it('derives ISSUED -> PARTIALLY_PAID -> PAID', () => {
    assert.equal(deriveStatus('ISSUED', 1000, 0), 'ISSUED');
    assert.equal(deriveStatus('ISSUED', 1000, 400), 'PARTIALLY_PAID');
    assert.equal(deriveStatus('PARTIALLY_PAID', 1000, 1000), 'PAID');
    assert.equal(deriveStatus('PAID', 1000, 400), 'PARTIALLY_PAID', 'voiding a receipt reverts it');
    assert.equal(deriveStatus('ISSUED', 1000, 1200), 'PAID', 'overpayment still settles');
  });

  it('keeps DRAFT and VOID sticky', () => {
    assert.equal(deriveStatus('DRAFT', 1000, 1000), 'DRAFT');
    assert.equal(deriveStatus('VOID', 1000, 1000), 'VOID');
  });

  describe('tax the client withheld', () => {
    it('counts as settling the invoice, not as money still owed', () => {
      // A 500,000 claim, client withholds 3% and sends 485,000.
      const p = { amount: 485_000, whtAmount: 15_000 };
      assert.equal(paymentSettledCents(p), 50_000_000);
      assert.notEqual(
        paymentSettledCents(p),
        toCents(p.amount),
        'the cash alone is not what cleared the invoice',
      );
    });

    it('clears the invoice to PAID rather than stranding it PARTIALLY_PAID', () => {
      // The bug this guards: counting cash alone leaves 15,000 outstanding
      // for ever, on an invoice that is fully settled. Nobody can ever
      // collect it, and it is chased as overdue every month.
      const netPayable = 50_000_000;
      const cashOnly = toCents(485_000);
      const settled = paymentSettledCents({ amount: 485_000, whtAmount: 15_000 });

      assert.equal(deriveStatus('ISSUED', netPayable, cashOnly), 'PARTIALLY_PAID');
      assert.equal(deriveStatus('ISSUED', netPayable, settled), 'PAID');
      assert.equal(invoiceBalanceCents(netPayable, settled), 0);
      assert.ok(invoiceBalanceCents(netPayable, cashOnly) > 0);
    });

    it('adds withholding VAT and withholding tax together', () => {
      const settled = paymentSettledCents({
        amount: 475_000,
        whtAmount: 15_000,
        whtVatAmount: 10_000,
      });
      assert.equal(settled, 50_000_000);
    });

    it('treats an absent withholding field as nothing withheld', () => {
      // Every payment recorded before these columns existed must behave
      // exactly as it always did.
      assert.equal(paymentSettledCents({ amount: 1_000 }), toCents(1_000));
    });

    it('sums a Prisma aggregate across all three money columns', () => {
      const dec = (n: number) => new Prisma.Decimal(n);
      assert.equal(
        aggregateSettledCents({
          amount: dec(485_000),
          whtAmount: dec(15_000),
          whtVatAmount: null,
        }),
        50_000_000,
      );
      // An aggregate over zero rows returns nulls, which is zero settled.
      assert.equal(
        aggregateSettledCents({ amount: null, whtAmount: null, whtVatAmount: null }),
        0,
      );
    });
  });

  it('buckets ageing from the due date', () => {
    const asOf = new Date('2026-07-31T09:00:00Z');
    const d = (s: string) => new Date(s);
    assert.equal(agingBucket(d('2026-08-30'), 100, asOf), 'CURRENT');
    assert.equal(agingBucket(d('2026-07-31'), 100, asOf), 'CURRENT', 'due today is not overdue');
    assert.equal(agingBucket(d('2026-07-20'), 100, asOf), 'D1_30');
    assert.equal(agingBucket(d('2026-06-15'), 100, asOf), 'D31_60');
    assert.equal(agingBucket(d('2026-05-15'), 100, asOf), 'D61_90');
    assert.equal(agingBucket(d('2026-01-15'), 100, asOf), 'D90_PLUS');
    assert.equal(agingBucket(d('2026-01-15'), 0, asOf), 'CURRENT', 'a settled invoice never ages');
  });
});
