import { Router } from "express";
import { registerCatalogRoutes } from "./catalog";
import { registerTicketRoutes } from "./tickets";

export const maintenanceRouter = Router();
registerCatalogRoutes(maintenanceRouter);
registerTicketRoutes(maintenanceRouter);
