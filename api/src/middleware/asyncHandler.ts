import type { RequestHandler } from "express";

/** Forward rejected promises from async Express 4 handlers to error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
