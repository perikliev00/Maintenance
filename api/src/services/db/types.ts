// Import module @prisma/client for this service.
import { Prisma } from "@prisma/client";

// Declare type Tx for callers and internals.
export type Tx = Prisma.TransactionClient;
