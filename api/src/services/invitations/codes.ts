/**
 * Invitation code generation and hashing (only the hash is stored).
 * Alphabet omits ambiguous characters (I/O/0/1).
 */
import { createHash, randomBytes } from "crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** SHA-256 of the normalized (trim + uppercase) invite code. */
export function hashInviteCode(code: string): string {
  // Normalize before hash so casing/whitespace variants collide to one row.
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/** Generate an 8-character invite code formatted as XXXX-XXXX. */
export function generateInviteCode(): string {
  // Eight random bytes mapped into the unambiguous alphabet.
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    // Modulo alphabet length — slight bias is fine for invite codes.
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  // Present as XXXX-XXXX for easier reading / typing on mobile.
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
