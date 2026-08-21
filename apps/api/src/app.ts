import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRouter from './modules/auth';
import usersRouter from './modules/users';
import projectsRouter from './modules/projects';
import clientsRouter from './modules/clients';
import leadsRouter from './modules/leads';
import quotationsRouter from './modules/quotations';
import contractsRouter from './modules/contracts';
import expensesRouter from './modules/expenses';
import materialRequestsRouter from './modules/materialRequests';
import snagsRouter from './modules/snags';
import safetyRouter from './modules/safety';
import calendarRouter from './modules/calendar';
import businessReportsRouter from './modules/businessReports';
import commandCentreRouter from './modules/commandCentre';
import chatRouter from './modules/chat';
import paymentsRouter from './modules/payments';
import invoicesRouter, { companyInvoicesRouter } from './modules/invoices';
import tasksRouter from './modules/tasks';
import workersRouter from './modules/workers';
import toolsRouter from './modules/tools';
import suppliersRouter from './modules/suppliers';
import taxRouter from './modules/tax';
import payrollRouter from './modules/payroll';
import attendanceRouter, { deviceRouter, adminDeviceRouter } from './modules/attendance';
import iclockRouter from './modules/iclock';
import stockRouter from './modules/stock';
import documentsRouter from './modules/documents';
import dailyReportsRouter from './modules/dailyReports';
import weeklyReportsRouter from './modules/weeklyReports';
import reportsRouter from './modules/reports';
import analyticsRouter from './modules/analytics';
import settingsRouter from './modules/settings';
import { serveUploads } from './middleware/upload';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // This app is read-heavy and its readers are on Kenyan mobile data. The
  // responses are JSON — highly repetitive keys, long prose fields — which
  // gzips to roughly a fifth of its size. Nothing else on this list buys as
  // much for as little. Uploads are already-compressed images and PDFs, and
  // sit above this middleware, so they are not run through it twice.
  app.use(compression());
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV === 'production' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Uploads are private: HMAC-signed, expiring links only.
  app.use('/uploads', serveUploads);
  // ZKTeco/ADMS fingerprint terminals push here (device-authenticated by SN).
  app.use('/iclock', iclockRouter);

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/clients', clientsRouter);
  v1.use('/leads', leadsRouter);
  v1.use('/quotations', quotationsRouter);
  v1.use('/contracts', contractsRouter);
  v1.use('/projects', projectsRouter);
  v1.use('/projects/:projectId/expenses', expensesRouter);
  v1.use('/projects/:projectId/material-requests', materialRequestsRouter);
  v1.use('/projects/:projectId/snags', snagsRouter);
  v1.use('/projects/:projectId/safety-incidents', safetyRouter);
  v1.use('/projects/:projectId/payments', paymentsRouter);
  v1.use('/projects/:projectId/invoices', invoicesRouter);
  v1.use('/projects/:projectId/tasks', tasksRouter);
  v1.use('/projects/:projectId/attendance', attendanceRouter);
  v1.use('/projects/:projectId/stock', stockRouter);
  v1.use('/projects/:projectId/documents', documentsRouter);
  v1.use('/projects/:projectId/daily-reports', dailyReportsRouter);
  v1.use('/projects/:projectId/weekly-reports', weeklyReportsRouter);
  v1.use('/invoices', companyInvoicesRouter); // cross-project A/R register
  v1.use('/reports', reportsRouter);
  v1.use('/workers', workersRouter);
  v1.use('/tools', toolsRouter);
  v1.use('/suppliers', suppliersRouter); // supplier list + company-wide payables
  v1.use('/tax', taxRouter); // VAT position and withholding, both sides
  v1.use('/payroll', payrollRouter);
  v1.use('/attendance', deviceRouter); // POST /attendance/device-sync (API-key auth)
  v1.use('/devices', adminDeviceRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/calendar', calendarRouter);
  v1.use('/projects/:projectId/business-reports', businessReportsRouter);
  v1.use('/projects/:projectId/command-centre', commandCentreRouter);
  v1.use('/chat', chatRouter); // read-only Q&A, scoped by the asking user
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
