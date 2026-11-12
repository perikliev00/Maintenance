// Load .env so INITIAL_OWNER_* and ALLOW_INITIAL_OWNER_CREATION are available.
import "dotenv/config";
// Hash the one-time owner password before persisting.
import bcrypt from "bcryptjs";
// Unique bootstrap employee number suffix.
import { randomUUID } from "node:crypto";
// Prisma Role enum for the owner privilege.
import { Role } from "@prisma/client";
// Shared Prisma client for the transactional owner create.
import { prisma } from "./db";
// Structured success/failure logging with redacted errors.
import { log, safeErrorMessage } from "./observability";

// Operator-invoked one-shot: create the first owner user if none exists.
async function main() {
  // Production requires an explicit opt-in so this cannot run accidentally.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_INITIAL_OWNER_CREATION !== "true") {
    throw new Error("Set ALLOW_INITIAL_OWNER_CREATION=true for this one-time operator-invoked command.");
  }
  // Normalize email to the same form login uses.
  const email = process.env.INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  // Display name for the linked Employee row.
  const fullName = process.env.INITIAL_OWNER_NAME?.trim();
  // Plain password from env; never logged.
  const password = process.env.INITIAL_OWNER_PASSWORD;
  // All three must be present; password must meet the 16-char floor.
  if (!email || !fullName || !password || password.length < 16) {
    throw new Error("INITIAL_OWNER_EMAIL, INITIAL_OWNER_NAME, and a 16+ character INITIAL_OWNER_PASSWORD are required.");
  }
  // bcrypt cost 12 balances security vs one-time bootstrap latency.
  const passwordHash = await bcrypt.hash(password, 12);
  // Single transaction so lock + uniqueness checks + creates are atomic.
  await prisma.$transaction(async (tx) => {
    // Serialize concurrent bootstrap attempts across processes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('maintenance-initial-owner'))`;
    // Refuse if an owner already exists — this command is first-owner only.
    if (await tx.user.findFirst({ where: { role: Role.owner } })) throw new Error("An owner already exists; refusing to create another initial owner.");
    // Refuse email collisions with any existing user.
    if (await tx.user.findUnique({ where: { email } })) throw new Error("The requested email is already in use.");
    // Employee row is required by the User.employeeId FK.
    const employee = await tx.employee.create({
      data: { employeeNumber: `BOOTSTRAP-${randomUUID()}`, fullName, department: "Administration" },
    });
    // Create the active owner User linked to that employee.
    await tx.user.create({
      data: { employeeId: employee.id, email, passwordHash, role: Role.owner, isActive: true, activatedAt: new Date() },
    });
  });
  // Confirm success for operators without echoing credentials.
  log.info("initial_owner_created");
}

// Surface fatal failures and disconnect Prisma on every exit path.
main().catch((error) => {
  log.fatal("initial_owner_creation_failed", { error: safeErrorMessage(error) });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
