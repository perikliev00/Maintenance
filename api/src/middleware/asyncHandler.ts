/** Express 4 helpers for async route handlers. */
import type { RequestHandler } from "express";

/**
 * Forward rejected promises from async Express 4 handlers to error middleware.
 * Express 5 does this natively; Express 4 needs an explicit catch.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    // Resolve thenables; route any rejection into next(err) for the app handler.
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
