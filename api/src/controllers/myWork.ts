import type { NextFunction, Request, Response } from "express";
import { getMyWork } from "../services/myWork";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    const shiftId =
      typeof req.query.shiftId === "string" ? req.query.shiftId : undefined;
    const data = await getMyWork(req.user!, hotelDate, shiftId);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}
