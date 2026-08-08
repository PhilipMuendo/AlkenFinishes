-- Site visits and client appointments are things someone books, so unlike the
-- derived feeds (deadlines, payroll, service dates, birthdays, retention) they
-- need to persist.
ALTER TYPE "CalendarEventType" ADD VALUE 'SITE_VISIT';
ALTER TYPE "CalendarEventType" ADD VALUE 'CLIENT_APPOINTMENT';
