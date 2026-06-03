// __tests__/canonicalize.test.ts
import { describe, it, expect } from "vitest";
import { canonicalize } from "../canonicalize.js";

describe("canonicalize", () => {
  it("produces identical output regardless of key order (the property signatures depend on)", () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });

  it("omits undefined-valued keys so optional fields don't change the hash", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("serializes arrays in order and nulls literally", () => {
    expect(canonicalize({ xs: [3, 1, 2], n: null })).toBe('{"n":null,"xs":[3,1,2]}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalize({ a: Infinity })).toThrow(/non-finite/);
  });

  it("throws on unsupported types such as bigint", () => {
    expect(() => canonicalize({ a: 10n })).toThrow(/unsupported type/);
  });
});
