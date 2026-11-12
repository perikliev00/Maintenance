/**
 * Shared Prisma status sets used by queries that treat work as still in flight
 * (active cleaning tasks / open maintenance tickets).
 */
// Prisma enums for cleaning task and maintenance ticket status values.
import { TaskStatus, TicketStatus } from "@prisma/client";

/** Cleaning task statuses that still occupy a location or assignee. */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  // Assigned but not yet started on the floor.
  TaskStatus.assigned,
  // Cleaner is actively working the location.
  TaskStatus.in_progress,
  // Waiting for supervisor inspection before completion.
  TaskStatus.awaiting_inspection,
  // Failed inspection; still open until rework finishes.
  TaskStatus.rework,
];

/** Maintenance ticket statuses that are not yet closed/resolved terminal. */
export const OPEN_TICKET_STATUSES: TicketStatus[] = [
  // Newly reported, not yet assigned.
  TicketStatus.new,
  // Assigned to a technician but not started.
  TicketStatus.assigned,
  // Technician is actively working the ticket.
  TicketStatus.in_progress,
  // Blocked on parts/external input; still open.
  TicketStatus.waiting,
];
