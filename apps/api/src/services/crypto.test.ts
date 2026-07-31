import test from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt } from './crypto';

test('encrypt/decrypt round-trips', () => {
  const plaintext = 'a BioStar 2 password with symbols !@#$%^&*()';
  const stored = encrypt(plaintext);
  assert.equal(decrypt(stored), plaintext);
});

test('encrypt is non-deterministic (random IV per call)', () => {
  const a = encrypt('same password');
  const b = encrypt('same password');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'same password');
  assert.equal(decrypt(b), 'same password');
});

test('decrypt rejects a tampered ciphertext', () => {
  const stored = encrypt('secret');
  const [iv, tag, ct] = stored.split(':');
  const tampered = `${iv}:${tag}:${ct.slice(0, -2)}${ct.slice(-2) === '00' ? '11' : '00'}`;
  assert.throws(() => decrypt(tampered));
});
