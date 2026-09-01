import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { hasFinanceAccess, requireFinanceProjectAccess } from '../middleware/rbac';
import { signFileUrl } from '../middleware/upload';
import { projectFinancials } from '../services/finance';
import { contractPosition } from '../services/pipeline';
import { projectReceivables } from '../services/invoicing';
import { buildInsights, projectCompletion, type InsightInput } from '../services/insights';
import { getSiteDaySettings, isLateCheckIn } from '../services/siteDay';
import { weightedProgress } from '../services/progress';

/**
 * One project's mission control: the figures and open items that would
 * otherwise take ten separate tab visits to piece together. Every figure here
 * is read from the same tables the individual tabs use — this endpoint exists
 * to save round trips, not to introduce a second source of truth.
 *
 * Money is assembled only for a superadmin or accountant. A supervisor's
 * response omits the financial sections entirely rather than zeroing them: an
 * absent key cannot leak, and the queries behind it are never run.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, requireFinanceProjectAccess);

const DAY = 86_400_000;
const PHOTO_LIMIT = 8;
const SAFETY_WINDOW_DAYS = 30;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const canSeeMoney = hasFinanceAccess(req.user!.role);

    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const in14Days = new Date(now.getTime() + 14 * DAY);
    const safetySince = new Date(now.getTime() - SAFETY_WINDOW_DAYS * DAY);

    const [
      project,
      siteDay,
      latestDailyReport,
      openSnags,
      overdueSnags,
      reworkAgg,
      pendingExpenses,
      pendingMaterialRequests,
      pendingOverrides,
      upcomingEvents,
      assignedWorkerCount,
      todayRecords,
      tools,
      safetyIncidents,
      photoReports,
      photoDocuments,
      latestWeekly,
      projectTasks,
    ] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          status: true,
          progressPct: true,
          startDate: true,
          expectedCompletion: true,
          supervisorId: true,
        },
      }),
      getSiteDaySettings(),
      prisma.dailyReport.findFirst({ where: { projectId }, orderBy: { date: 'desc' } }),
      prisma.snagItem.groupBy({
        by: ['severity'],
        where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] } },
        _count: true,
      }),
      prisma.snagItem.count({
        where: {
          projectId,
          status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] },
          dueDate: { lt: startOfToday },
        },
      }),
      prisma.snagItem.aggregate({ where: { projectId }, _sum: { reworkCount: true } }),
      prisma.expense.count({ where: { projectId, status: 'PENDING' } }),
      prisma.materialRequest.count({ where: { projectId, status: 'PENDING' } }),
      prisma.attendanceOverrideRequest.count({ where: { projectId, status: 'PENDING' } }),
      prisma.calendarEvent.findMany({
        where: {
          date: { gte: startOfToday, lte: in14Days },
          OR: [{ projectId }, { projectId: null }],
        },
        orderBy: { date: 'asc' },
        take: 10,
      }),
      prisma.workerAssignment.count({ where: { projectId, endDate: null } }),
      prisma.attendanceRecord.findMany({
        where: { projectId, date: startOfToday },
        select: { checkIn: true, checkOut: true },
      }),
      prisma.tool.findMany({
        where: { currentProjectId: projectId },
        select: { id: true, name: true, category: true, status: true, nextServiceDate: true },
        orderBy: { name: 'asc' },
      }),
      prisma.safetyIncident.findMany({
        where: { projectId, occurredAt: { gte: safetySince } },
        select: { id: true, severity: true, description: true, occurredAt: true },
        orderBy: { occurredAt: 'desc' },
      }),
      // Site-diary photos are the richest source: dated, and already the thing
      // a supervisor uploads daily.
      prisma.dailyReport.findMany({
        where: { projectId, photoUrls: { isEmpty: false } },
        select: { date: true, photoUrls: true },
        orderBy: { date: 'desc' },
        take: PHOTO_LIMIT,
      }),
      prisma.document.findMany({
        where: { projectId, type: 'PHOTO' },
        select: { id: true, name: true, fileUrl: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: PHOTO_LIMIT,
      }),
      prisma.weeklyReport.findFirst({
        where: { projectId },
        orderBy: { weekEnding: 'desc' },
        select: { weekEnding: true },
      }),
      prisma.task.findMany({
        where: { projectId },
        select: { completionPct: true, weight: true },
      }),
    ]);

    // ---- Money, superadmin only -------------------------------------------
    // Assembled in a branch rather than a conditional expression so each value
    // keeps its own type; a ternary over a tuple collapses them into a union
    // that is useless downstream.
    type MoneyBundle = {
      financials: Awaited<ReturnType<typeof projectFinancials>> | null;
      contract: Awaited<
        ReturnType<
          typeof prisma.contract.findUnique<{
            where: { projectId: string };
            include: { variations: { select: { amount: true; status: true } } };
          }>
        >
      >;
      receivables: Awaited<ReturnType<typeof projectReceivables>> | null;
    };
    let money: MoneyBundle = { financials: null, contract: null, receivables: null };
    if (canSeeMoney) {
      const [financials, contract, receivables] = await Promise.all([
        projectFinancials(projectId),
        prisma.contract.findUnique({
          where: { projectId },
          include: { variations: { select: { amount: true, status: true } } },
        }),
        projectReceivables(projectId),
      ]);
      money = { financials, contract, receivables };
    }
    const { financials, contract, receivables } = money;

    // ---- 1. Progress against programme ------------------------------------
    // Recomputed here rather than trusted from project.progressPct alone,
    // because the card needs to say whether the figure is weighted — a
    // projection off an unweighted mean is worth a good deal less.
    const taskProgress = weightedProgress(
      projectTasks.map((t) => ({ completionPct: t.completionPct, weight: Number(t.weight) })),
    );
    const insightInputBase = {
      today: now,
      status: project.status,
      startDate: project.startDate,
      expectedCompletion: project.expectedCompletion,
      progressPct: project.progressPct,
      progressIsWeighted: taskProgress.weighted,
      supervisorAssigned: project.supervisorId != null,
    };
    const completion = projectCompletion({
      ...insightInputBase,
      daysSinceLastReport: null,
      budget: { totalBudget: 0, totalActual: 0, consumedPct: null },
      invoices: { outstanding: 0, overdue: 0, overdueCount: 0, oldestOverdueDays: 0 },
      snags: { open: 0, overdue: 0, highOpen: 0, rework: 0 },
      attendance: { assigned: 0, present: 0 },
      equipment: { down: 0, serviceOverdue: 0 },
      safety: { seriousLast30d: 0, totalLast30d: 0 },
    });
    const programme = {
      actualPct: project.progressPct,
      weighted: taskProgress.weighted,
      unweightedTaskCount: taskProgress.unweightedTaskCount,
      taskCount: taskProgress.taskCount,
      plannedPct: completion?.plannedPct ?? null,
      slipDays: completion?.slipDays ?? null,
      projectedFinish: completion?.projectedFinish ?? null,
      startDate: project.startDate,
      expectedCompletion: project.expectedCompletion,
      daysRemaining: Math.ceil((project.expectedCompletion.getTime() - now.getTime()) / DAY),
    };

    // ---- 2. Today's attendance --------------------------------------------
    const present = todayRecords.length;
    const late = todayRecords.filter((r) => isLateCheckIn(r.checkIn, siteDay)).length;
    const checkInTimes = todayRecords.map((r) => r.checkIn.getTime());
    const checkOutTimes = todayRecords
      .filter((r) => r.checkOut != null)
      .map((r) => r.checkOut!.getTime());
    const attendance = {
      assignedWorkers: assignedWorkerCount,
      checkedInToday: present,
      late,
      // Only meaningful against a roster; without assignments this is not
      // "everyone turned up", it is "we do not know who was expected".
      absent: assignedWorkerCount > 0 ? Math.max(0, assignedWorkerCount - present) : null,
      stillOpen: todayRecords.filter((r) => r.checkOut == null).length,
      firstCheckIn: checkInTimes.length ? new Date(Math.min(...checkInTimes)) : null,
      lastCheckOut: checkOutTimes.length ? new Date(Math.max(...checkOutTimes)) : null,
      dayStart: siteDay.dayStart,
    };

    // ---- 11. Open defects --------------------------------------------------
    const openSnagsBySeverity = Object.fromEntries(
      openSnags.map((s) => [s.severity, s._count]),
    ) as Record<string, number>;
    const snags = {
      open: openSnags.reduce((s, g) => s + g._count, 0),
      bySeverity: openSnagsBySeverity,
      overdue: overdueSnags,
      rework: reworkAgg._sum.reworkCount ?? 0,
    };

    // ---- 12. Equipment status ----------------------------------------------
    const serviceOverdue = tools.filter(
      (t) => t.nextServiceDate != null && t.nextServiceDate < startOfToday,
    );
    const equipment = {
      total: tools.length,
      active: tools.filter((t) => t.status === 'ACTIVE').length,
      down: tools.filter((t) => t.status === 'MAINTENANCE' || t.status === 'RETIRED').length,
      serviceOverdue: serviceOverdue.length,
      items: tools.slice(0, 8).map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        status: t.status,
        nextServiceDate: t.nextServiceDate,
        serviceOverdue: t.nextServiceDate != null && t.nextServiceDate < startOfToday,
      })),
    };

    // ---- 13. Safety alerts --------------------------------------------------
    const safety = {
      windowDays: SAFETY_WINDOW_DAYS,
      total: safetyIncidents.length,
      bySeverity: {
        SERIOUS: safetyIncidents.filter((s) => s.severity === 'SERIOUS').length,
        MINOR: safetyIncidents.filter((s) => s.severity === 'MINOR').length,
        NEAR_MISS: safetyIncidents.filter((s) => s.severity === 'NEAR_MISS').length,
      },
      recent: safetyIncidents.slice(0, 4),
    };

    // ---- 10. Daily photos ---------------------------------------------------
    const diaryPhotos = photoReports.flatMap((r) =>
      r.photoUrls.map((url, idx) => ({
        id: `${r.date.toISOString()}-${idx}`,
        url: signFileUrl(url),
        takenAt: r.date,
        caption: null as string | null,
      })),
    );
    const documentPhotos = photoDocuments.map((d) => ({
      id: d.id,
      url: signFileUrl(d.fileUrl),
      takenAt: d.createdAt,
      caption: d.name,
    }));
    const photos = [...diaryPhotos, ...documentPhotos]
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
      .slice(0, PHOTO_LIMIT);

    // ---- Reporting cadence, feeds the insight engine -------------------------
    const lastReportAt = [latestDailyReport?.date, latestWeekly?.weekEnding]
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const daysSinceLastReport =
      lastReportAt == null ? null : Math.floor((now.getTime() - lastReportAt.getTime()) / DAY);

    // ---- 4/5/6/7. Materials, budget, profit, invoices ------------------------
    const materialsCategory = financials?.categories.find((c) => c.category === 'MATERIALS') ?? null;
    const materials = materialsCategory && {
      allocated: materialsCategory.allocated,
      actual: materialsCategory.actual,
      remaining: materialsCategory.remaining,
      consumedPct: materialsCategory.consumedPct,
      health: materialsCategory.health,
    };
    const profit =
      financials &&
      (() => {
        const revenue = receivables ? receivables.invoicedNet : financials.contractValue;
        const cost = financials.totalActual;
        const gross = revenue - cost;
        return {
          revenueEarned: revenue,
          totalCost: cost,
          grossProfit: gross,
          marginPct: revenue > 0 ? Math.round((gross / revenue) * 1000) / 10 : null,
          estimatedProfit: financials.estimatedProfit,
        };
      })();
    const invoices = receivables && {
      invoiced: receivables.invoicedNet,
      collected: receivables.totalCollected,
      outstanding: receivables.arOutstanding,
      overdue: receivables.arOverdue,
      overdueCount: receivables.counts.overdue,
      oldestOverdueDays: receivables.oldestOverdueDays,
      retentionHeld: receivables.retentionHeld,
    };

    // ---- 14. Insights --------------------------------------------------------
    const insightInput: InsightInput = {
      ...insightInputBase,
      daysSinceLastReport,
      budget: {
        totalBudget: financials?.totalBudget ?? 0,
        totalActual: financials?.totalActual ?? 0,
        consumedPct: financials?.overallConsumedPct ?? null,
      },
      invoices: {
        outstanding: receivables?.arOutstanding ?? 0,
        overdue: receivables?.arOverdue ?? 0,
        overdueCount: receivables?.counts.overdue ?? 0,
        oldestOverdueDays: receivables?.oldestOverdueDays ?? 0,
      },
      snags: {
        open: snags.open,
        overdue: snags.overdue,
        highOpen: openSnagsBySeverity.HIGH ?? 0,
        rework: snags.rework,
      },
      attendance: { assigned: assignedWorkerCount, present },
      equipment: { down: equipment.down, serviceOverdue: equipment.serviceOverdue },
      safety: {
        seriousLast30d: safety.bySeverity.SERIOUS,
        totalLast30d: safety.total,
      },
    };
    const insights = buildInsights(insightInput, { includeFinancial: canSeeMoney });

    res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
      },
      canSeeMoney,
      programme,
      attendance,
      snags,
      equipment,
      safety,
      photos,
      insights,
      pendingApprovals: {
        expenses: pendingExpenses,
        materialRequests: pendingMaterialRequests,
        attendanceOverrides: pendingOverrides,
      },
      upcomingEvents,
      latestDailyReport: latestDailyReport
        ? { date: latestDailyReport.date, workersPresent: latestDailyReport.workersPresent }
        : null,
      daysSinceLastReport,

      // Money — null for a supervisor, and the queries behind them never ran.
      financials,
      contractPosition: contract ? contractPosition(contract, contract.variations) : null,
      // A site raised directly, with no contract behind it, is missing the
      // commercial half of the system and gives no sign of it. Saying so is
      // what stops somebody discovering it weeks later at the claim screen.
      contractLinked: canSeeMoney ? contract !== null : null,
      materials,
      profit,
      invoices,
    });
  }),
);

export default router;
