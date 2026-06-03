// packages/passport-core/__tests__/hash.test.ts
import { describe, it, expect } from "vitest";
import { sha256Hex } from "../hash.js";

describe("sha256Hex", () => {
  it("matches the known SHA-256 vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns 64 lowercase hex chars", () => {
    expect(sha256Hex("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
