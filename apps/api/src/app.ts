import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRouter from './modules/auth';
import usersRouter from './modules/users';
import projectsRouter from './modules/projects';
import expensesRouter from './modules/expenses';
import paymentsRouter from './modules/payments';
import tasksRouter from './modules/tasks';
import workersRouter from './modules/workers';
import toolsRouter from './modules/tools';
import attendanceRouter, { deviceRouter, adminDeviceRouter } from './modules/attendance';
import stockRouter from './modules/stock';
import documentsRouter from './modules/documents';
import dailyReportsRouter from './modules/dailyReports';
import analyticsRouter from './modules/analytics';
import settingsRouter from './modules/settings';
import { serveUploads } from './middleware/upload';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV === 'production' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Uploads are private: HMAC-signed, expiring links only.
  app.use('/uploads', serveUploads);

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/projects', projectsRouter);
  v1.use('/projects/:projectId/expenses', expensesRouter);
  v1.use('/projects/:projectId/payments', paymentsRouter);
  v1.use('/projects/:projectId/tasks', tasksRouter);
  v1.use('/projects/:projectId/attendance', attendanceRouter);
  v1.use('/projects/:projectId/stock', stockRouter);
  v1.use('/projects/:projectId/documents', documentsRouter);
  v1.use('/projects/:projectId/daily-reports', dailyReportsRouter);
  v1.use('/workers', workersRouter);
  v1.use('/tools', toolsRouter);
  v1.use('/attendance', deviceRouter); // POST /attendance/device-sync (API-key auth)
  v1.use('/devices', adminDeviceRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/settings', settingsRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
