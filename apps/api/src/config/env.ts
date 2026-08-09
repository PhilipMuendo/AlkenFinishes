import 'dotenv/config';
import { z } from 'zod';

/**
 * An unset docker-compose variable arrives as an empty string, not as absent.
 * Treat it as absent, or an optional enum rejects "" and the process exits.
 */
const blankToUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // Encrypts BioStar 2 device credentials at rest (services/crypto.ts). Any
  // length works — it's hashed down to a 256-bit key — so this can be any
  // random string, not necessarily hex.
  ENCRYPTION_KEY: z.string().min(32).default('dev-only-encryption-key-not-for-production-use'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(15),
  CORS_ORIGIN: z.string().default('*'),
  APP_TIMEZONE: z.string().default('Africa/Nairobi'),
  FILE_URL_TTL_SECONDS: z.coerce.number().default(3600),
  MAX_SHIFT_HOURS: z.coerce.number().default(14),
  // Reading photographed receipts. OPTIONAL: with no key the feature is simply
  // absent and every form still works by hand. Receipt images leave the
  // building when a key is set, so it is opt-in by configuration.
  //
  // Whichever key is present is used, Gemini first because it is the cheaper
  // read. RECEIPT_PROVIDER forces one when both are configured, which is what
  // makes falling back to a better reader a config change rather than a
  // deploy. RECEIPT_MODEL overrides the provider's default model.
  //
  // Every one of these is preprocessed from "" to undefined: docker-compose
  // passes an unset variable through as an EMPTY STRING, and an empty string
  // fails an enum. Without this the API refuses to boot the moment the
  // optional block is present in compose but unconfigured.
  GEMINI_API_KEY: blankToUndefined(z.string().optional()),
  ANTHROPIC_API_KEY: blankToUndefined(z.string().optional()),
  RECEIPT_PROVIDER: blankToUndefined(z.enum(['gemini', 'anthropic']).optional()),
  RECEIPT_MODEL: blankToUndefined(z.string().optional()),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Refuse to boot production with placeholder secrets.
const KNOWN_PLACEHOLDER = /change-me|changeme|dev-secret|example|placeholder/i;
if (parsed.data.NODE_ENV === 'production' && KNOWN_PLACEHOLDER.test(parsed.data.JWT_SECRET)) {
  // eslint-disable-next-line no-console
  console.error('JWT_SECRET looks like a placeholder. Set a real secret before deploying.');
  process.exit(1);
}
if (parsed.data.NODE_ENV === 'production' && KNOWN_PLACEHOLDER.test(parsed.data.ENCRYPTION_KEY)) {
  // eslint-disable-next-line no-console
  console.error('ENCRYPTION_KEY looks like a placeholder. Set a real secret before deploying.');
  process.exit(1);
}

export const env = parsed.data;
