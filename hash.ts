// hash.ts
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}
