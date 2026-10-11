import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DailyPlanCategory } from "@prisma/client";
import { prisma } from "../db";
import { todayHotelDateYmd } from "../services/hotelTime";
import {
  applyDepartureRoomEffects,
  createDailyPlanEntry,
  deleteDailyPlanEntry,
  getDailyPlan,
  importDailyPlan,
} from "../services/dailyPlan";
import {
  assertCanAccessLocation,
  locationWhere,
  resolveDataScope,
} from "../services/dataScope";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const hotelDateBodySchema = z.object({
  hotelDate: dateSchema,
  confirmEntryIds: z.array(z.string().min(1)).max(500).optional(),
});

const importSchema = z.object({
  hotelDate: dateSchema,
  sourceLabel: z.string().min(1).max(100).default("clock"),
  entries: z
    .array(
      z.object({
        buildingCode: z.string().min(1).max(32),
        roomNumber: z.string().min(1).max(32),
        category: z.nativeEnum(DailyPlanCategory),
        notes: z.string().max(500).optional(),
        externalId: z.string().min(1).max(200).optional(),
      }),
    )
    .max(2000),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const hotelDate =
      typeof req.query.hotelDate === "string"
        ? req.query.hotelDate
        : await todayHotelDateYmd();
    const parsed = dateSchema.safeParse(hotelDate);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        message: "hotelDate must be YYYY-MM-DD",
      });
    }
    const scope = await resolveDataScope(req.user!);
    const plan = await getDailyPlan(parsed.data, locationWhere(scope));
    return res.json(plan);
  } catch (err) {
    return next(err);
  }
}

export async function applyDepartureEffects(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = hotelDateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    const scope = await resolveDataScope(req.user!);
    const result = await applyDepartureRoomEffects(
      parsed.data.hotelDate,
      locationWhere(scope),
      { confirmEntryIds: parsed.data.confirmEntryIds },
    );
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function importPlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "unauthorized", message: "Missing user" });
    }

    const scope = await resolveDataScope(req.user);
    const result = await importDailyPlan(
      parsed.data,
      req.user.employeeId,
      locationWhere(scope),
    );
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const schema = z.object({
      hotelDate: dateSchema,
      locationId: z.string().min(1),
      category: z.nativeEnum(DailyPlanCategory),
      notes: z.string().max(500).optional(),
      assignedEmployeeId: z.string().min(1).optional(),
      shiftId: z.string().min(1).nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation", details: parsed.error.flatten() });
    }
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "unauthorized", message: "Missing user" });
    }

    const scope = await resolveDataScope(req.user);
    await assertCanAccessLocation(scope, parsed.data.locationId);

    const result = await createDailyPlanEntry({
      ...parsed.data,
      createdByEmployeeId: req.user.employeeId,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.dailyPlanEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, locationId: true },
    });
    if (!existing) {
      return res.status(404).json({
        error: "not_found",
        message: "Plan entry not found",
      });
    }
    const scope = await resolveDataScope(req.user!);
    await assertCanAccessLocation(scope, existing.locationId);

    const result = await deleteDailyPlanEntry(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
