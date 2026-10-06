-- Deduplicate concurrent running sessions / active tasks, then enforce
-- partial unique indexes as hard DB invariants for cleaning transitions.

-- 1) Extra running sessions per task → keep newest; cancel older
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "startedAt" DESC, id DESC) AS rn
  FROM "CleaningSession"
  WHERE status = 'running'
)
UPDATE "CleaningSession" s
SET
  status = 'cancelled',
  "finishedAt" = COALESCE(s."finishedAt", NOW()),
  notes = CASE
    WHEN s.notes IS NULL OR s.notes = '' THEN 'Auto-cancelled: duplicate running session (task invariant)'
    ELSE s.notes || ' | Auto-cancelled: duplicate running session (task invariant)'
  END
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

-- 2) Extra running sessions per employee → keep newest; cancel older
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "employeeId" ORDER BY "startedAt" DESC, id DESC) AS rn
  FROM "CleaningSession"
  WHERE status = 'running'
)
UPDATE "CleaningSession" s
SET
  status = 'cancelled',
  "finishedAt" = COALESCE(s."finishedAt", NOW()),
  notes = CASE
    WHEN s.notes IS NULL OR s.notes = '' THEN 'Auto-cancelled: duplicate running session (employee invariant)'
    ELSE s.notes || ' | Auto-cancelled: duplicate running session (employee invariant)'
  END
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

-- 3) Extra active tasks per room/date → keep newest; cancel older
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "locationId", "hotelDate"
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM "CleaningTask"
  WHERE status IN ('assigned', 'in_progress', 'awaiting_inspection', 'rework')
)
UPDATE "CleaningTask" t
SET status = 'cancelled'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

-- Hard invariants (Prisma cannot express partial uniques in schema)
CREATE UNIQUE INDEX "CleaningSession_one_running_per_task"
  ON "CleaningSession" ("taskId") WHERE status = 'running';

CREATE UNIQUE INDEX "CleaningSession_one_running_per_employee"
  ON "CleaningSession" ("employeeId") WHERE status = 'running';

CREATE UNIQUE INDEX "CleaningTask_one_active_per_room_date"
  ON "CleaningTask" ("locationId", "hotelDate")
  WHERE status IN ('assigned', 'in_progress', 'awaiting_inspection', 'rework');
