/**
 * Shared base64url JSON cursor transport. Domain modules keep their own
 * payload schemas and error policies (400 vs soft-fail).
 */

const DEFAULT_MAX_LENGTH = 2048;
// Capture default charset for use in this scope.
const DEFAULT_CHARSET = /^[A-Za-z0-9_-]+$/;

// Declare type CursorCodecOptions for callers and internals.
export type CursorCodecOptions = {
  // Run next step: maxLength?: number;
  maxLength?: number;
  /** When true, reject cursors that fail length/charset before decode. */
  guard?: boolean;
};

/** Encode an arbitrary JSON-serializable value as a base64url cursor. */
export function encodeBase64UrlJson(value: unknown): string {
  // Return the computed result to the caller.
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Decode a base64url JSON cursor to an unknown value.
 * Throws on malformed base64/JSON (or guard failure when enabled).
 */
export function decodeBase64UrlJson(
  // Set raw on the structure being built.
  raw: string,
  // Set opts on the structure being built.
  opts: CursorCodecOptions = {},
// Run next step: ): unknown {
): unknown {
  // Capture max length for use in this scope.
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  // Branch when this condition holds so the right path runs.
  if (opts.guard !== false) {
    // Branch when this condition holds so the right path runs.
    if (raw.length > maxLength || !DEFAULT_CHARSET.test(raw)) {
      // Abort with an error so callers can react.
      throw new Error("invalid cursor transport");
    }
  }
  // Return the computed result to the caller.
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}
