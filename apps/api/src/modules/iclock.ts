import { Router } from 'express';
import express from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { asyncHandler } from '../utils/http';
import { ingestPunches, type Punch } from '../services/attendanceIngest';
import { deviceSyncLimiter } from '../middleware/rateLimit';

/**
 * ZKTeco "ADMS" / push (iclock) adapter. A fingerprint terminal configured
 * with this server's address pushes punches here over HTTP — no per-site
 * bridge needed. The device authenticates by its serial number (SN), which
 * an admin registers on the matching AttendanceDevice. Punches are turned
 * into attendance by the shared ingest service (first-in / last-out).
 *
 * NOTE: firmware varies. The handshake config below is the common default;
 * a specific device may need field-tuning. Attendance upload + parsing is the
 * stable part and is covered by tests.
 */
const router = Router();

// Devices send tab-separated text, not JSON.
router.use(express.text({ type: '*/*', limit: '2mb' }));

async function deviceForSN(sn: unknown) {
  if (typeof sn !== 'string' || !sn) return null;
  const device = await prisma.attendanceDevice.findUnique({ where: { serialNumber: sn } });
  return device && device.active ? device : null;
}

// Handshake / config pull. The device polls this first and on a timer.
router.get(
  '/cdata',
  asyncHandler(async (req, res) => {
    const device = await deviceForSN(req.query.SN);
    if (!device) {
      logger.warn({ sn: req.query.SN }, 'iclock handshake from unregistered device');
      return res.type('text/plain').send('OK'); // don't make the device retry-storm
    }
    // Standard push config: send all attendance logs, poll every 10s.
    const cfg = [
      `GET OPTION FROM: ${device.serialNumber}`,
      'ATTLOGStamp=None',
      'OPERLOGStamp=None',
      'ErrorDelay=30',
      'Delay=10',
      'TransTimes=00:00;12:00',
      'TransInterval=1',
      'TransFlag=TransData AttLog',
      'Realtime=1',
      'Encrypt=0',
    ].join('\n');
    res.type('text/plain').send(`${cfg}\n`);
  }),
);

// Attendance / operation log upload.
router.post(
  '/cdata',
  deviceSyncLimiter,
  asyncHandler(async (req, res) => {
    const device = await deviceForSN(req.query.SN);
    if (!device) return res.type('text/plain').send('OK');

    const table = String(req.query.table ?? '').toUpperCase();
    if (table && table !== 'ATTLOG') {
      // OPERLOG / other tables aren't attendance — acknowledge and ignore.
      return res.type('text/plain').send('OK');
    }

    const body = typeof req.body === 'string' ? req.body : '';
    const punches: Punch[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // ATTLOG: PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify \t ...
      const [pin, datetime] = line.split('\t');
      if (!pin || !datetime) continue;
      const ts = new Date(`${datetime.trim().replace(' ', 'T')}Z`);
      if (Number.isNaN(ts.getTime())) continue;
      punches.push({ biometricId: pin.trim(), timestamp: ts });
    }

    const summary = await ingestPunches(device, punches);
    logger.info(
      {
        sn: device.serialNumber,
        received: summary.received,
        accepted: summary.accepted,
        issues: summary.issues.length,
      },
      'iclock attendance upload',
    );
    // ZKTeco expects an OK acknowledgement to advance its cursor.
    res.type('text/plain').send(`OK: ${summary.received}`);
  }),
);

// The device polls for server-issued commands (add/delete users, etc.).
// We push none — just keep it happy.
router.get('/getrequest', (_req, res) => res.type('text/plain').send('OK'));
router.post('/devicecmd', (_req, res) => res.type('text/plain').send('OK'));

export default router;
