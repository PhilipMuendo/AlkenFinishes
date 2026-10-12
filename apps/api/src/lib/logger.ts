import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  // pino-http logs every request's headers. Without this, each line carries
  // the caller's full bearer token (valid for the access-token TTL) and any
  // cookie, in plain text, in container logs that get shipped, pasted into
  // chats and read by whoever debugs. Attendance terminals authenticate with
  // an x-device-key header, so that one is redacted too.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-device-key"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});
