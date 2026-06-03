import { describe, it, expect } from "vitest";
import { commitField, verifyOpening } from "../commitments.js";

describe("commitField / verifyOpening", () => {
  it("is deterministic and 64-char lowercase hex", () => {
    const c1 = commitField("SN-12345", "salt-abc");
    const c2 = commitField("SN-12345", "salt-abc");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with a different salt (hiding) and with a different value", () => {
    const base = commitField("SN-12345", "salt-abc");
    expect(commitField("SN-12345", "salt-xyz")).not.toBe(base);
    expect(commitField("SN-99999", "salt-abc")).not.toBe(base);
  });

  it("commits structured values, not just strings", () => {
    const c = commitField({ price: 4200, currency: "CHF" }, "s");
    expect(verifyOpening(c, { price: 4200, currency: "CHF" }, "s")).toBe(true);
  });

  it("verifyOpening accepts the true opening and rejects wrong value/salt/commitment", () => {
    const c = commitField("SN-12345", "salt-abc");
    expect(verifyOpening(c, "SN-12345", "salt-abc")).toBe(true);
    expect(verifyOpening(c, "SN-00000", "salt-abc")).toBe(false);
    expect(verifyOpening(c, "SN-12345", "salt-xyz")).toBe(false);
    expect(verifyOpening("deadbeef", "SN-12345", "salt-abc")).toBe(false);
  });
});
