import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAction } from "../middleware/auth";
import { AppError } from "../errors";
import { canPerform } from "../services/roleGrants";
import {
  createShift,
  listShiftRoster,
  listShifts,
  updateShift,
  upsertShiftRoster,
} from "../services/shifts";

export const shiftsRouter = Router();

const hhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hotelDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

shiftsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const role = req.user!.role;
    const canCatalog = await canPerform(role, "shifts.manage");
    if (includeInactive && !canCatalog) {
      throw new AppError(403, "forbidden", "shifts.manage required");
    }
    if (
      !canCatalog &&
      !(await canPerform(role, "plan.manage")) &&
      !(await canPerform(role, "cleaning.create")) &&
      !(await canPerform(role, "cleaning.reassign"))
    ) {
      throw new AppError(403, "forbidden", "Not allowed to list shifts");
    }
    const shifts = await listShifts(includeInactive);
    return res.json(shifts);
  } catch (err) {
    return next(err);
  }
});

shiftsRouter.get(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const hotelDate = hotelDateSchema.safeParse(req.query.hotelDate);
      if (!hotelDate.success) {
        return res.status(400).json({
          error: "validation",
          message: "hotelDate query (YYYY-MM-DD) is required",
        });
      }
      const roster = await listShiftRoster(hotelDate.data);
      return res.json(roster);
    } catch (err) {
      return next(err);
    }
  },
);

shiftsRouter.put(
  "/roster",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        hotelDate: hotelDateSchema,
        entries: z.array(
          z.object({
            employeeId: z.string().min(1),
            shiftId: z.string().min(1),
          }),
        ),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const roster = await upsertShiftRoster({
        ...parsed.data,
        actorEmployeeId: req.user!.employeeId,
      });
      return res.json(roster);
    } catch (err) {
      return next(err);
    }
  },
);

shiftsRouter.post(
  "/",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(1).max(32),
        nameBg: z.string().min(1).max(120),
        nameEn: z.string().min(1).max(120),
        startTime: hhMm,
        endTime: hhMm,
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const shift = await createShift(parsed.data);
      return res.status(201).json(shift);
    } catch (err) {
      return next(err);
    }
  },
);

shiftsRouter.patch(
  "/:id",
  requireAuth,
  requireAction("shifts.manage"),
  async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(1).max(32).optional(),
        nameBg: z.string().min(1).max(120).optional(),
        nameEn: z.string().min(1).max(120).optional(),
        startTime: hhMm.optional(),
        endTime: hhMm.optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "validation", details: parsed.error.flatten() });
      }
      const shift = await updateShift(req.params.id, parsed.data);
      return res.json(shift);
    } catch (err) {
      return next(err);
    }
  },
);
