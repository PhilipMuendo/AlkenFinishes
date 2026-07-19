import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/http';

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

export function fileUrl(filename: string) {
  return `/uploads/${filename}`;
}
