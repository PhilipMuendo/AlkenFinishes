import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ApiError } from '../utils/http';
import { logger } from '../lib/logger';

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const dir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(dir, { recursive: true });

// Thumbnails are derived, cached files, kept separate from the originals so
// the upload directory stays a flat 1:1 map of DB rows to source files.
const thumbDir = path.join(dir, '.thumbs');
fs.mkdirSync(thumbDir, { recursive: true });

const storage = multer.diskStorage({
  destination: dir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(ApiError.badRequest(`File type ${file.mimetype} not allowed`));
    }
    cb(null, true);
  },
});

// ---- Content validation: never trust the client-declared MIME type ----

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  // Legacy Office (OLE compound file)
  'application/msword': (b) => b.readUInt32BE(0) === 0xd0cf11e0,
  'application/vnd.ms-excel': (b) => b.readUInt32BE(0) === 0xd0cf11e0,
  // OOXML (zip container)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    b[0] === 0x50 && b[1] === 0x4b,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) =>
    b[0] === 0x50 && b[1] === 0x4b,
};

/**
 * Verifies the file's magic bytes match its declared MIME type, then — for
 * images — recompresses it in place. Deletes the file and throws on a
 * magic-byte mismatch; call immediately after multer accepts it.
 *
 * The recompression is the point: a phone camera photo routinely arrives at
 * 3-8MB and 3000-4500px wide. Nothing in this app displays an image larger
 * than a couple of hundred pixels (the largest on-screen use is a lightbox),
 * and the generated report/invoice PDFs don't embed uploaded photos at all —
 * only the company logo, which this same path also resizes. Every upload
 * (receipts, site photos, defect photos, proof-of-transfer, the company logo)
 * goes through this one function, so shrinking it here is a single change
 * that caps disk use for the entire app rather than 13 separate call sites
 * each remembering to do it.
 */
export async function verifyUpload(file: Express.Multer.File | undefined): Promise<void> {
  if (!file) return;
  const check = MAGIC[file.mimetype];
  let ok = false;
  try {
    const fd = await fs.promises.open(file.path, 'r');
    const buf = Buffer.alloc(16);
    await fd.read(buf, 0, 16, 0);
    await fd.close();
    ok = !!check && file.size >= 8 && check(buf);
  } catch {
    ok = false;
  }
  if (!ok) {
    await fs.promises.unlink(file.path).catch(() => undefined);
    throw ApiError.badRequest('File content does not match its declared type');
  }
  if (file.mimetype.startsWith('image/')) {
    await compressImageInPlace(file);
  }
}

// Longest side any uploaded photo is kept at. Generous for on-screen use
// (nothing renders larger than a lightbox) and for a receipt or defect photo
// printed on a report — well beyond what a couple of hundred DPI needs at
// normal photo-print sizes.
const MAX_IMAGE_DIMENSION = 2000;
const JPEG_QUALITY = 82;
const PNG_COMPRESSION_LEVEL = 9;

/**
 * Resizes an uploaded image down to MAX_IMAGE_DIMENSION and re-encodes it,
 * replacing the file on disk. An opaque PNG (the overwhelming majority of
 * PNG uploads here — screenshots, some phone camera output) converts to JPEG,
 * since lossless PNG on a photograph is routinely 5-10x the size for no
 * visible benefit. A PNG WITH transparency is kept as PNG and only resized —
 * that's the company logo path, and flattening it to JPEG would print a solid
 * background onto every invoice, quotation and contract letterhead.
 *
 * Failure here must never fail the upload: a corrupt or unusual image (odd
 * color profile, animated WebP, etc.) falls back to keeping the original
 * file exactly as multer wrote it.
 */
async function compressImageInPlace(file: Express.Multer.File): Promise<void> {
  try {
    const img = sharp(file.path, { failOn: 'none' });
    const meta = await img.metadata();
    const resized = img
      .rotate() // bakes in EXIF orientation before the dimensions below are read from it
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });

    // Only an opaque PNG converts to JPEG — a transparent one is the company
    // logo path, and JPEG has no transparency to flatten it onto without
    // printing a solid background on every letterhead. WebP round-trips as
    // WebP either way; it already handles transparency natively.
    const convertToJpeg = file.mimetype === 'image/png' && !meta.hasAlpha;
    const outExt = convertToJpeg ? '.jpg' : path.extname(file.path);
    const outPath = `${file.path}.tmp${outExt}`;

    if (file.mimetype === 'image/jpeg' || convertToJpeg) {
      await resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(outPath);
    } else if (file.mimetype === 'image/webp') {
      await resized.webp({ quality: JPEG_QUALITY }).toFile(outPath);
    } else {
      await resized.png({ compressionLevel: PNG_COMPRESSION_LEVEL }).toFile(outPath);
    }

    const originalSize = file.size;
    const { size: newSize } = await fs.promises.stat(outPath);
    // A tiny, already-optimized source (e.g. a re-upload of something this
    // same pipeline already compressed) can come out fractionally larger
    // after a second lossy pass. Keep whichever is actually smaller.
    if (newSize >= originalSize) {
      await fs.promises.unlink(outPath).catch(() => undefined);
      return;
    }

    if (convertToJpeg) {
      // Extension must match the re-encoded format — fileUrl()/serveUploads()
      // both derive Content-Type from the on-disk extension.
      await fs.promises.unlink(file.path).catch(() => undefined);
      const newPath = `${file.path.slice(0, -path.extname(file.path).length)}.jpg`;
      await fs.promises.rename(outPath, newPath);
      file.path = newPath;
      file.filename = path.basename(newPath);
      file.mimetype = 'image/jpeg';
    } else {
      await fs.promises.rename(outPath, file.path);
    }
    file.size = newSize;
  } catch (e) {
    logger.warn({ filePath: file.path, err: e }, 'image compression failed, keeping original');
  }
}

export async function verifyUploads(files: Express.Multer.File[] | undefined): Promise<void> {
  for (const f of files ?? []) await verifyUpload(f);
}

export function fileUrl(filename: string) {
  return `/uploads/${filename}`;
}

/** Best-effort removal of a stored upload when its DB record is deleted. */
export function removeUploadedFile(url: string | null | undefined) {
  if (!url) return;
  const filename = path.basename(url.split('?')[0]);
  fs.promises
    .unlink(path.join(dir, filename))
    .catch((e) => logger.warn({ filename, err: e.code }, 'upload cleanup skipped'));
  removeThumbnails(filename);
}

// ---- Signed URLs: uploads are private; links expire ----

function sig(payload: string) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex').slice(0, 43);
}

export function signFileUrl<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  const clean = String(url).split('?')[0];
  const exp = Math.floor(Date.now() / 1000) + env.FILE_URL_TTL_SECONDS;
  return `${clean}?exp=${exp}&sig=${sig(`${clean}:${exp}`)}` as T;
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const RESIZABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Fixed allowlist, not an arbitrary client-chosen width — otherwise every
// distinct value in `?w=` becomes its own cached file on disk forever.
// Covers the thumbnail sizes actually used in the UI (64-80px, @1x/@2x).
const ALLOWED_THUMB_WIDTHS = new Set([160, 320]);

/** Resizes to a cached JPEG thumbnail on first request; reused after that. */
async function getOrCreateThumbnail(filePath: string, width: number): Promise<string> {
  const thumbPath = path.join(thumbDir, `${path.basename(filePath)}-w${width}.jpg`);
  if (!fs.existsSync(thumbPath)) {
    // Flattens transparency onto white — fine for photos, the only content
    // these thumbnails are used for (receipts, task/report photos).
    await sharp(filePath)
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 78 })
      .toFile(thumbPath);
  }
  return thumbPath;
}

/** Validates the signature, then serves the file (or a resized thumbnail) with safe headers. */
export async function serveUploads(req: Request, res: Response, next: NextFunction) {
  const exp = Number(req.query.exp);
  const provided = String(req.query.sig ?? '');
  const clean = `/uploads/${path.basename(req.path)}`;
  const expected = sig(`${clean}:${exp}`);
  if (
    !exp ||
    exp < Date.now() / 1000 ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return next(ApiError.unauthorized('File link is invalid or has expired'));
  }
  const filePath = path.join(dir, path.basename(req.path));
  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext];

  const width = Number(req.query.w);
  if (RESIZABLE_EXTS.has(ext) && ALLOWED_THUMB_WIDTHS.has(width)) {
    try {
      const thumbPath = await getOrCreateThumbnail(filePath, width);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(thumbPath, { headers: { 'Content-Type': 'image/jpeg' } }, (err) => {
        if (err) next(ApiError.notFound('File not found'));
      });
    } catch (e) {
      logger.warn({ filePath, width, err: e }, 'thumbnail generation failed, serving original');
    }
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Images/PDFs render inline; everything else downloads.
  res.setHeader('Content-Disposition', type ? 'inline' : 'attachment');
  res.sendFile(filePath, { headers: type ? { 'Content-Type': type } : undefined }, (err) => {
    if (err) next(ApiError.notFound('File not found'));
  });
}

/** Best-effort removal of a cached thumbnail alongside its source file. */
function removeThumbnails(filename: string) {
  for (const width of ALLOWED_THUMB_WIDTHS) {
    fs.promises.unlink(path.join(thumbDir, `${filename}-w${width}.jpg`)).catch(() => undefined);
  }
}
