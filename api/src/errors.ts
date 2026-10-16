/**
 * Typed operational error mapped to an HTTP response by the app error handler.
 * Prefer throwing AppError from services/controllers over ad-hoc status codes.
 */
export class AppError extends Error {
  /**
   * @param status HTTP status code returned to the client.
   * @param code Stable machine-readable error code (e.g. "forbidden").
   * @param message Human-readable message for the client JSON body.
   * @param details Optional structured details (validation flatten, etc.).
   */
  constructor(
    /** HTTP status code returned to the client. */
    public status: number,
    /** Stable machine-readable error code (e.g. "forbidden"). */
    public code: string,
    message: string,
    /** Optional structured details (validation flatten, etc.). */
    public details?: unknown,
  ) {
    // Preserve message on the Error base; name stays "Error" unless callers set it.
    super(message);
  }
}
