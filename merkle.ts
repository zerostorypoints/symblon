// merkle.ts
import { sha256Hex } from "./hash.js";

/**
 * Binary Merkle root over an ordered list of leaf hashes (hex). Odd nodes at a
 * level are paired with themselves. Dormant in Phase 0 — present so future
 * public-ledger anchoring of a batch of payloadHashes needs no engine change.
 */
export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error("computeMerkleRoot: empty leaf set");
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0]!;
}
