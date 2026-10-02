import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { getMyWork } from "../services/myWork";

export const myWorkRouter = Router();

myWorkRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const hotelDate =
      typeof req.query.hotelDate === "string" ? req.query.hotelDate : undefined;
    const data = await getMyWork(req.user!, hotelDate);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});
