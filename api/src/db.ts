/**
 * Shared Prisma client for the API process (one connection pool per process).
 * Import this singleton from services/controllers instead of constructing
 * additional PrismaClient instances.
 */
// Prisma ORM client constructor for the shared singleton below.
import { PrismaClient } from "@prisma/client";

/** Process-wide Prisma client (connection pool shared across handlers). */
export const prisma = new PrismaClient();
