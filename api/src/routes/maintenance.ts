import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../services/cleaning";
import {
  createMaintenanceTicket,
  listMaintenanceTickets,
  resolveMaintenanceTicket,
} from "../services/maintenance";

export const maintenanceRouter = Router();

maintenanceRouter.get("/tickets", requireAuth, async (req, res, next) => {
  try {
    const locationId =
      typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const statusParam =
      typeof req.query.status === "string" ? req.query.status : "open";
    const resolvedOnly = statusParam === "resolved";
    const openOnly =
      !resolvedOnly &&
      (req.query.open === "true" ||
        (req.query.open !== "false" && statusParam !== "all"));
    const limitRaw =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const limit =
      limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 100)
        : undefined;

    const tickets = await listMaintenanceTickets({
      locationId,
      openOnly,
      resolvedOnly,
      limit,
    });
    return res.json(tickets);
  } catch (err) {
    return next(err);
  }
});

maintenanceRouter.post("/tickets", requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      locationId: z.string().min(1),
      title: z.string().min(1),
      category: z.enum(["climate", "electrical", "furniture", "plumbing", "other"]),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      blocksRoom: z.boolean(),
      commandId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    }

    const result = await createMaintenanceTicket({
      ...parsed.data,
      reportedByEmployeeId: req.user!.employeeId,
    });

    return res.status(result.idempotent ? 200 : 201).json(result.ticket);
  } catch (err) {
    return next(err);
  }
});

maintenanceRouter.post(
  "/tickets/:id/resolve",
  requireAuth,
  requireAction("tickets.resolve"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        resolutionNotes: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      }

      const ticket = await resolveMaintenanceTicket({
        ticketId: req.params.id,
        resolvedByEmployeeId: req.user!.employeeId,
        resolutionNotes: parsed.data.resolutionNotes,
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
