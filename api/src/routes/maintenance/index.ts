/** /maintenance — issue catalog + ticket workflow routes. */
import { Router } from "express";
import { registerCatalogRoutes } from "./catalog";
import { registerTicketRoutes } from "./tickets";

// Aggregate maintenance router; catalog and ticket modules register here.
export const maintenanceRouter = Router();
// Issue categories and options (catalog).
registerCatalogRoutes(maintenanceRouter);
// Ticket list/create and lifecycle (assign/start/wait/resolve/close/reopen).
registerTicketRoutes(maintenanceRouter);
