import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, signToken } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { employee: true },
  });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid credentials" });
  }

  const token = signToken({
    userId: user.id,
    employeeId: user.employeeId,
    role: user.role,
    email: user.email,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      fullName: user.employee.fullName,
    },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { employee: true },
  });
  if (!user) {
    return res.status(401).json({ error: "unauthorized", message: "User not found" });
  }
  return res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    fullName: user.employee.fullName,
  });
});
