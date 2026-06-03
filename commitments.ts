// commitments.ts
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./hash.js";

/**
 * Commit to a field value under a salt: lowercase-hex SHA-256 over the
 * canonicalized `{ value, salt }`. The salt is caller-supplied entropy (purity
 * rule — no randomness inside the engine); it hides the value and defeats
 * dictionary attacks on low-entropy fields. The raw `(value, salt)` opening is
 * held in custody and revealed in a Presentation.
 */
export function commitField(value: unknown, salt: string): string {
  return sha256Hex(canonicalize({ value, salt }));
}

/** True iff `(value, salt)` opens to `commitment`. */
export function verifyOpening(commitment: string, value: unknown, salt: string): boolean {
  return commitField(value, salt) === commitment;
}
