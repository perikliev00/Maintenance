import { TaskStatus, TicketStatus } from "@prisma/client";

export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.assigned,
  TaskStatus.in_progress,
  TaskStatus.awaiting_inspection,
  TaskStatus.rework,
];

export const OPEN_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.new,
  TicketStatus.assigned,
  TicketStatus.in_progress,
  TicketStatus.waiting,
];

export const OVERDUE_SESSION_MINUTES = 240;
