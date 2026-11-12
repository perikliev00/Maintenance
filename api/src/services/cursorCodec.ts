/**
 * Shared base64url JSON cursor transport. Domain modules keep their own
 * payload schemas and error policies (400 vs soft-fail).
 */

const DEFAULT_MAX_LENGTH = 2048;
// Capture default charset for use in this scope.
const DEFAULT_CHARSET = /^[A-Za-z0-9_-]+$/;

// Declare type CursorCodecOptions for callers and internals.
export type CursorCodecOptions = {
  maxLength?: number;
  /** When true, reject cursors that fail length/charset before decode. */
  guard?: boolean;
};

/** Encode an arbitrary JSON-serializable value as a base64url cursor. */
export function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Decode a base64url JSON cursor to an unknown value.
 * Throws on malformed base64/JSON (or guard failure when enabled).
 */
export function decodeBase64UrlJson(
  raw: string,
  opts: CursorCodecOptions = {},
): unknown {
  // Capture max length for use in this scope.
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  if (opts.guard !== false) {
    if (raw.length > maxLength || !DEFAULT_CHARSET.test(raw)) {
      throw new Error("invalid cursor transport");
    }
  }
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}
