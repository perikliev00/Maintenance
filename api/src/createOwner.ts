import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { prisma } from "./db";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_INITIAL_OWNER_CREATION !== "true") {
    throw new Error("Set ALLOW_INITIAL_OWNER_CREATION=true for this one-time operator-invoked command.");
  }
  const email = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const fullName = process.env.INITIAL_OWNER_NAME?.trim();
  const password = process.env.INITIAL_OWNER_PASSWORD;
  if (!email || !fullName || !password || password.length < 16) {
    throw new Error("INITIAL_OWNER_EMAIL, INITIAL_OWNER_NAME, and a 16+ character INITIAL_OWNER_PASSWORD are required.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('maintenance-initial-owner'))`;
    if (await tx.user.findFirst({ where: { role: Role.owner } })) throw new Error("An owner already exists; refusing to create another initial owner.");
    if (await tx.user.findUnique({ where: { email } })) throw new Error("The requested email is already in use.");
    const employee = await tx.employee.create({
      data: { employeeNumber: `BOOTSTRAP-${randomUUID()}`, fullName, department: "Administration" },
    });
    await tx.user.create({
      data: { employeeId: employee.id, email, passwordHash, role: Role.owner, isActive: true, activatedAt: new Date() },
    });
  });
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "maintenance-api", event: "initial_owner_created" }));
}

main().catch((error) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "fatal", service: "maintenance-api", event: "initial_owner_creation_failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
