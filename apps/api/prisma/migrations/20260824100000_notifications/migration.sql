-- The in-app notification bell. One row is one problem, reopened by dedupeKey
-- rather than duplicated on every scan — the same shape AttendanceSyncIssue
-- already uses. Read state is per-user (NotificationRead), so the same
-- Notification can be unread for one supervisor and read for another.

CREATE TYPE "NotificationType" AS ENUM (
  'SYNC_ISSUE',
  'BUDGET_OVER_THRESHOLD',
  'PAYMENT_OVERDUE',
  'INVOICE_OVERDUE',
  'CONTRACT_AWAITING_SIGNATURE'
);

CREATE TABLE "Notification" (
  "id"          TEXT NOT NULL,
  "type"        "NotificationType" NOT NULL,
  "dedupeKey"   TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "projectId"   TEXT,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"  TIMESTAMP(3),

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_resolvedAt_lastSeenAt_idx" ON "Notification"("resolvedAt", "lastSeenAt");
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationRead" (
  "id"             TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "readAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRead_notificationId_userId_key" ON "NotificationRead"("notificationId", "userId");

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
