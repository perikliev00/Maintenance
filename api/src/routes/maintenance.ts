import { Router } from "express";
import { IssueOptionKind, Priority, Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { isOwner } from "../permissions";
import { AppError } from "../errors";
import {
  archiveCategory,
  archiveIssueOption,
  createCategory,
  createIssueOption,
  listCategories,
  listIssueOptions,
  reorderIssueOptions,
  updateCategory,
  updateIssueOption,
} from "../services/issueCatalog";
import {
  assignMaintenanceTicket,
  closeMaintenanceTicket,
  createMaintenanceTicket,
  listMaintenanceTickets,
  listTicketEvents,
  reopenMaintenanceTicket,
  resolveMaintenanceTicket,
  resumeMaintenanceTicket,
  startMaintenanceTicket,
  waitMaintenanceTicket,
} from "../services/maintenance";
import {
  assertCanAccessLocation,
  assertCanAccessTicket,
  resolveDataScope,
  ticketWhere,
} from "../services/dataScope";

export const maintenanceRouter = Router();

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const kindSchema = z.nativeEnum(IssueOptionKind);

function canBypassTicketAssignee(role: Role): boolean {
  return (
    isOwner(role) ||
    role === Role.supervisor ||
    role === Role.manager ||
    role === Role.admin ||
    role === Role.reception
  );
}

maintenanceRouter.get(
  "/categories",
  requireAuth,
  requireAction("tickets.report"),
  async (req, res, next) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const categories = await listCategories({ activeOnly: !includeInactive });
      return res.json(categories);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/categories",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        key: z.string().min(1).max(32),
        nameBg: z.string().min(1).max(120),
        nameEn: z.string().min(1).max(120),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const row = await createCategory(parsed.data);
      return res.status(201).json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.patch(
  "/categories/:id",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        nameBg: z.string().min(1).max(120).optional(),
        nameEn: z.string().min(1).max(120).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const row = await updateCategory(req.params.id, parsed.data);
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/categories/:id/archive",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const row = await archiveCategory(req.params.id);
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.get(
  "/issue-options",
  requireAuth,
  requireAction("tickets.report"),
  async (req, res, next) => {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const categoryId =
        typeof req.query.categoryId === "string"
          ? req.query.categoryId
          : undefined;
      const options = await listIssueOptions({
        activeOnly: !includeInactive,
        categoryId,
      });
      return res.json(options);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/issue-options/reorder",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const rows = await reorderIssueOptions(parsed.data.ids);
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/issue-options",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        maintenanceCategoryId: z.string().min(1),
        kind: kindSchema,
        nameBg: z.string().min(1).max(200),
        nameEn: z.string().min(1).max(200),
        defaultPriority: prioritySchema.optional(),
        defaultBlocksRoom: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const row = await createIssueOption({
        ...parsed.data,
        defaultPriority: parsed.data.defaultPriority as Priority | undefined,
      });
      return res.status(201).json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.patch(
  "/issue-options/:id",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        maintenanceCategoryId: z.string().min(1).optional(),
        kind: kindSchema.optional(),
        nameBg: z.string().min(1).max(200).optional(),
        nameEn: z.string().min(1).max(200).optional(),
        defaultPriority: prioritySchema.nullable().optional(),
        defaultBlocksRoom: z.boolean().nullable().optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const row = await updateIssueOption(req.params.id, {
        ...parsed.data,
        defaultPriority: parsed.data.defaultPriority as
          | Priority
          | null
          | undefined,
      });
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/issue-options/:id/archive",
  requireAuth,
  requireAction("issue_options.manage"),
  async (req, res, next) => {
    try {
      const row = await archiveIssueOption(req.params.id);
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.get("/tickets", requireAuth, requireAction("tickets.report"), async (req, res, next) => {
  try {
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const statusParam =
      typeof req.query.status === "string" ? req.query.status : "open";
    const assigneeIdParam =
      typeof req.query.assigneeId === "string" ? req.query.assigneeId : undefined;
    const priorityParam =
      typeof req.query.priority === "string" ? req.query.priority : undefined;
    const slaBreached =
      req.query.slaBreached === "1" ||
      req.query.slaBreached === "true" ||
      req.query.slaBreached === "yes";
    const blocksRoom =
      req.query.blocksRoom === "1" || req.query.blocksRoom === "true"
        ? true
        : req.query.blocksRoom === "0" || req.query.blocksRoom === "false"
          ? false
          : undefined;
    const resolvedOnly = statusParam === "resolved";
    const openOnly =
      !resolvedOnly &&
      (req.query.open === "true" ||
        (req.query.open !== "false" &&
          statusParam !== "all" &&
          !statusParam.includes(",")));
    const statuses =
      statusParam.includes(",") ||
      ["new", "assigned", "in_progress", "waiting", "resolved", "closed"].includes(
        statusParam,
      )
        ? (statusParam
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean) as import("@prisma/client").TicketStatus[])
        : undefined;
    const mine =
      req.query.mine === "1" ||
      req.query.mine === "true" ||
      req.query.mine === "yes";
    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const limit =
      limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 100)
        : undefined;

    if (mine && !req.user?.employeeId) {
      return res.status(401).json({ error: "unauthorized", message: "Missing user" });
    }

    const scope = await resolveDataScope(req.user!);
    const tickets = await listMaintenanceTickets({
      locationId,
      assigneeId: mine ? req.user!.employeeId : assigneeIdParam,
      openOnly: statuses ? false : openOnly,
      resolvedOnly: statuses ? false : resolvedOnly,
      statuses:
        statuses && statusParam !== "open" && statusParam !== "all"
          ? statuses
          : undefined,
      priority: priorityParam as import("@prisma/client").Priority | undefined,
      slaBreached: slaBreached || undefined,
      blocksRoom,
      limit,
      scopeWhere: ticketWhere(scope),
    });
    return res.json(tickets);
  } catch (err) {
    return next(err);
  }
});

maintenanceRouter.post(
  "/tickets",
  requireAuth,
  requireAction("tickets.report"),
  async (req, res, next) => {
    try {
      const schema = z
        .object({
          locationId: z.string().min(1),
          title: z.string().min(1).optional(),
          issueOptionId: z.string().min(1).optional(),
          categoryId: z.string().min(1).optional(),
          priority: prioritySchema.optional(),
          blocksRoom: z.boolean(),
          commandId: z.string().uuid().optional(),
        })
        .refine(
          (data) =>
            (data.issueOptionId && !data.categoryId) ||
            (!data.issueOptionId && data.categoryId),
          {
            message: "Provide exactly one of issueOptionId or categoryId",
          },
        )
        .refine(
          (data) =>
            data.issueOptionId ||
            (data.categoryId && data.title && data.title.trim().length > 0),
          {
            message: "title is required when using categoryId",
          },
        );
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      await assertCanAccessLocation(scope, parsed.data.locationId);

      const result = await createMaintenanceTicket({
        ...parsed.data,
        priority: parsed.data.priority as Priority | undefined,
        reportedByEmployeeId: req.user!.employeeId,
      });

      return res.status(result.idempotent ? 200 : 201).json(result.ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.get(
  "/tickets/:id/events",
  requireAuth,
  requireAction("tickets.report"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const events = await listTicketEvents(req.params.id);
      return res.json(events);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/assign",
  requireAuth,
  requireAction("tickets.assign"),
  async (req, res, next) => {
    try {
      const schema = z.object({ assigneeId: z.string().min(1) });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await assignMaintenanceTicket({
        ticketId: req.params.id,
        assigneeId: parsed.data.assigneeId,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/start",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({ commandId: z.string().uuid().optional() });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await startMaintenanceTicket({
        ticketId: req.params.id,
        actorEmployeeId: req.user!.employeeId,
        bypassAssigneeCheck: canBypassTicketAssignee(req.user!.role),
        commandId: parsed.data.commandId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/wait",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        reason: z.string().optional(),
        commandId: z.string().uuid().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await waitMaintenanceTicket({
        ticketId: req.params.id,
        actorEmployeeId: req.user!.employeeId,
        reason: parsed.data.reason,
        bypassAssigneeCheck: canBypassTicketAssignee(req.user!.role),
        commandId: parsed.data.commandId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/resume",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({ commandId: z.string().uuid().optional() });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await resumeMaintenanceTicket({
        ticketId: req.params.id,
        actorEmployeeId: req.user!.employeeId,
        bypassAssigneeCheck: canBypassTicketAssignee(req.user!.role),
        commandId: parsed.data.commandId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/resolve",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        resolutionNotes: z.string().optional(),
        commandId: z.string().uuid().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await resolveMaintenanceTicket({
        ticketId: req.params.id,
        resolvedByEmployeeId: req.user!.employeeId,
        resolutionNotes: parsed.data.resolutionNotes,
        bypassAssigneeCheck: canBypassTicketAssignee(req.user!.role),
        commandId: parsed.data.commandId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/close",
  requireAuth,
  requireAction("tickets.close"),
  async (req, res, next) => {
    try {
      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await closeMaintenanceTicket({
        ticketId: req.params.id,
        closedByEmployeeId: req.user!.employeeId,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.post(
  "/tickets/:id/reopen",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        reason: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }

      const scope = await resolveDataScope(req.user!);
      await assertCanAccessTicket(scope, req.params.id);
      const ticket = await reopenMaintenanceTicket({
        ticketId: req.params.id,
        reopenedByEmployeeId: req.user!.employeeId,
        reason: parsed.data.reason,
      });
      return res.json(ticket);
    } catch (err) {
      return next(err);
    }
  },
);

maintenanceRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  return next(err);
});
