import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// verifyUpload() reads env.UPLOAD_DIR at import time (mkdirSync), so point it
// at a scratch dir and dynamic-import inside before() rather than at the top
// of the file — a static import would be hoisted ahead of these env writes.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_SECRET ??= 'test-secret-at-least-32-characters-long';
process.env.UPLOAD_DIR = scratch;

let verifyUpload: (typeof import('./upload'))['verifyUpload'];
test.before(async () => {
  ({ verifyUpload } = await import('./upload'));
});

function fakeFile(filePath: string, mimetype: string): Express.Multer.File {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    filename: path.basename(filePath),
    mimetype,
    size: stat.size,
    fieldname: 'file',
    originalname: path.basename(filePath),
    encoding: '7bit',
    destination: path.dirname(filePath),
    buffer: Buffer.alloc(0),
    stream: undefined as never,
  };
}

/** A large, genuinely photographic JPEG — a flat-color square barely compresses, this must actually shrink. */
async function makePhotoJpeg(filePath: string, size = 3000) {
  const noise = Buffer.alloc(size * size * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  await sharp(noise, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(filePath);
}

test('compresses an oversized JPEG down to the max dimension', async () => {
  const p = path.join(scratch, 'photo.jpg');
  await makePhotoJpeg(p, 3000);
  const before = fs.statSync(p).size;
  const file = fakeFile(p, 'image/jpeg');

  await verifyUpload(file);

  const meta = await sharp(file.path).metadata();
  assert.ok(
    meta.width! <= 2000 && meta.height! <= 2000,
    `expected <=2000px, got ${meta.width}x${meta.height}`,
  );
  const after = fs.statSync(file.path).size;
  assert.ok(after < before, `expected compression to shrink the file (${before} -> ${after})`);
  assert.equal(file.size, after);
});

test('opaque PNG converts to JPEG', async () => {
  const p = path.join(scratch, 'opaque.png');
  await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: { r: 40, g: 60, b: 90 } },
  })
    .png()
    .toFile(p);
  const file = fakeFile(p, 'image/png');

  await verifyUpload(file);

  assert.equal(file.mimetype, 'image/jpeg');
  assert.match(file.filename, /\.jpg$/);
  assert.ok(fs.existsSync(file.path));
  assert.ok(!fs.existsSync(p), 'original .png should be removed once converted');
});

test('transparent PNG (e.g. a logo) stays PNG with transparency intact', async () => {
  const p = path.join(scratch, 'logo.png');
  await sharp({
    create: {
      width: 2400,
      height: 800,
      channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 0 },
    },
  })
    .png()
    .toFile(p);
  const file = fakeFile(p, 'image/png');

  await verifyUpload(file);

  assert.equal(file.mimetype, 'image/png');
  const meta = await sharp(file.path).metadata();
  assert.equal(meta.hasAlpha, true);
  assert.ok(meta.width! <= 2000);
});

test('a small image already under the size cap is left alone in dimensions', async () => {
  const p = path.join(scratch, 'small.jpg');
  await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg({ quality: 90 })
    .toFile(p);
  const file = fakeFile(p, 'image/jpeg');

  await verifyUpload(file);

  const meta = await sharp(file.path).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 300);
});

test('a corrupt image never blocks the upload — original file survives', async () => {
  const p = path.join(scratch, 'corrupt.jpg');
  // Valid JPEG magic bytes (passes verifyUpload's own check) but garbage after.
  fs.writeFileSync(
    p,
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not a real jpeg')]),
  );
  const file = fakeFile(p, 'image/jpeg');

  await assert.doesNotReject(verifyUpload(file));
  assert.ok(
    fs.existsSync(file.path),
    'original must still be there after a failed compression attempt',
  );
});

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
