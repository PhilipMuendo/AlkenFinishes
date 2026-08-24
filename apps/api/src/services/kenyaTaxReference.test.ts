import test from 'node:test';
import assert from 'node:assert/strict';
import { KENYA_TAX_REFERENCE } from './kenyaTaxReference';

// A thin guard, not a content review: the point is that a future edit cannot
// silently drop the one thing that makes this content safe to hand the model
// as "facts" — the instruction that it is general background to verify, not
// this company's own data.
test('the tax reference tells the model it is not this company\'s own data', () => {
  assert.match(KENYA_TAX_REFERENCE, /not tax advice/i);
  assert.match(KENYA_TAX_REFERENCE, /confirm|verify/i);
});

test('the tax reference points at Settings for this company\'s own configured rates rather than restating them', () => {
  assert.match(KENYA_TAX_REFERENCE, /Settings > Money & tax/);
});
