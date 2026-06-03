// __tests__/merkle.test.ts
import { describe, it, expect } from "vitest";
import { computeMerkleRoot } from "../merkle.js";
import { sha256Hex } from "../hash.js";

describe("computeMerkleRoot", () => {
  it("returns the single leaf unchanged for a one-leaf set", () => {
    expect(computeMerkleRoot(["aa"])).toBe("aa");
  });

  it("hashes the concatenation of two leaves (known shape)", () => {
    expect(computeMerkleRoot(["aa", "bb"])).toBe(sha256Hex("aabb"));
  });

  it("is deterministic for the same ordered leaves", () => {
    const leaves = ["aa", "bb", "cc", "dd"];
    expect(computeMerkleRoot(leaves)).toBe(computeMerkleRoot([...leaves]));
  });

  it("promotes the odd leaf by self-pairing (3 leaves)", () => {
    const l = sha256Hex("aabb");
    const r = sha256Hex("cccc"); // odd 'cc' paired with itself
    expect(computeMerkleRoot(["aa", "bb", "cc"])).toBe(sha256Hex(l + r));
  });

  it("throws on an empty set", () => {
    expect(() => computeMerkleRoot([])).toThrow(/empty/);
  });
});
