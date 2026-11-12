/**
 * Prisma unique-constraint helpers for concurrent idempotent ticket commands.
 */
import { isP2002 } from "../db/prismaErrors";

// Re-export selected symbols for barrel consumers.
export { isP2002 };
