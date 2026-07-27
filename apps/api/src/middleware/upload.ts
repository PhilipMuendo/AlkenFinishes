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
 * Verifies the file's magic bytes match its declared MIME type. Deletes the
 * file and throws on mismatch — call immediately after multer accepts it.
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
    fs.promises
      .unlink(path.join(thumbDir, `${filename}-w${width}.jpg`))
      .catch(() => undefined);
  }
}
