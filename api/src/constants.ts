/**
 * Shared Prisma status sets used by queries that treat work as still in flight
 * (active cleaning tasks / open maintenance tickets).
 */
import { TaskStatus, TicketStatus } from "@prisma/client";

/** Cleaning task statuses that still occupy a location or assignee. */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.assigned,
  TaskStatus.in_progress,
  TaskStatus.awaiting_inspection,
  TaskStatus.rework,
];

/** Maintenance ticket statuses that are not yet closed/resolved terminal. */
export const OPEN_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.new,
  TicketStatus.assigned,
  TicketStatus.in_progress,
  TicketStatus.waiting,
];
