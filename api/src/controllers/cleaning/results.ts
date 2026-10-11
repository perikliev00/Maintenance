import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getCleaningResults } from "../../services/cleaningResults";
import {
  resolveDataScope,
  sessionTaskWhere,
  taskWhere,
} from "../../services/dataScope";
import { todayHotelDateYmd } from "../../services/hotelTime";

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const today = await todayHotelDateYmd();
    const serviceTypeEnum = z.enum([
      "stayover",
      "departure",
      "arrival",
      "common_area",
    ]);
    const schema = z.object({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .default(today),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .default(today),
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
      serviceType: z
        .union([
          serviceTypeEnum,
          z.string().transform((s) => s.split(",").map((x) => x.trim())),
        ])
        .optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation",
        details: parsed.error.flatten(),
      });
    }
    if (parsed.data.from > parsed.data.to) {
      return res.status(400).json({
        error: "validation",
        message: "`from` must be on or before `to`",
      });
    }

    const rawTypes = parsed.data.serviceType;
    let serviceTypes: Array<
      "stayover" | "departure" | "arrival" | "common_area"
    > | undefined;
    if (rawTypes !== undefined) {
      const list = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
      const checked = z.array(serviceTypeEnum).safeParse(list);
      if (!checked.success) {
        return res.status(400).json({
          error: "validation",
          details: checked.error.flatten(),
        });
      }
      serviceTypes = checked.data;
    }

    const scope = await resolveDataScope(req.user!);
    const result = await getCleaningResults({
      from: parsed.data.from,
      to: parsed.data.to,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      serviceTypes,
      sessionWhere: sessionTaskWhere(scope),
      taskWhere: taskWhere(scope),
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
