import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/rbac';
import { projectFinancials } from '../services/finance';
import { contractPosition } from '../services/pipeline';

/**
 * One project's mission control: the figures and open items that would
 * otherwise take ten separate tab visits to piece together. Every figure
 * here is read from the same tables the individual tabs use — this endpoint
 * exists to save round trips, not to introduce a second source of truth.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireProjectAccess);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const in14Days = new Date(Date.now() + 14 * 86_400_000);

    const [
      financials,
      contract,
      latestDailyReport,
      openSnags,
      overdueSnags,
      pendingExpenses,
      pendingMaterialRequests,
      pendingOverrides,
      upcomingEvents,
      assignedWorkerCount,
      todayAttendanceCount,
      openAttendanceRecords,
    ] = await Promise.all([
      projectFinancials(projectId),
      prisma.contract.findUnique({
        where: { projectId },
        include: { variations: { select: { amount: true, status: true } } },
      }),
      prisma.dailyReport.findFirst({ where: { projectId }, orderBy: { date: 'desc' } }),
      prisma.snagItem.groupBy({
        by: ['severity'],
        where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        _count: true,
      }),
      prisma.snagItem.count({
        where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: startOfToday } },
      }),
      prisma.expense.count({ where: { projectId, status: 'PENDING' } }),
      prisma.materialRequest.count({ where: { projectId, status: 'PENDING' } }),
      prisma.attendanceOverrideRequest.count({ where: { projectId, status: 'PENDING' } }),
      prisma.calendarEvent.findMany({
        where: { projectId, date: { gte: startOfToday, lte: in14Days } },
        orderBy: { date: 'asc' },
        take: 10,
      }),
      prisma.workerAssignment.count({ where: { projectId, endDate: null } }),
      prisma.attendanceRecord.count({ where: { projectId, date: startOfToday } }),
      prisma.attendanceRecord.count({ where: { projectId, checkOut: null } }),
    ]);

    const openSnagsBySeverity = Object.fromEntries(
      openSnags.map((s) => [s.severity, s._count]),
    ) as Record<string, number>;

    res.json({
      financials,
      contractPosition: contract ? contractPosition(contract, contract.variations) : null,
      latestDailyReport: latestDailyReport
        ? { date: latestDailyReport.date, workersPresent: latestDailyReport.workersPresent }
        : null,
      snags: {
        open: openSnags.reduce((s, g) => s + g._count, 0),
        bySeverity: openSnagsBySeverity,
        overdue: overdueSnags,
      },
      pendingApprovals: {
        expenses: pendingExpenses,
        materialRequests: pendingMaterialRequests,
        attendanceOverrides: pendingOverrides,
      },
      upcomingEvents,
      attendance: {
        assignedWorkers: assignedWorkerCount,
        checkedInToday: todayAttendanceCount,
        stillOpen: openAttendanceRecords,
      },
    });
  }),
);

export default router;
