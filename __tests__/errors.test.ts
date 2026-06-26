import { describe, it, expect } from "vitest";
import { HeadConflictError } from "../index.js";
import type { Subject } from "../index.js";

describe("HeadConflictError", () => {
  const subject: Subject = { scheme: "test.unit", id: "abc" };

  it("is an Error and a HeadConflictError with the right name", () => {
    const e = new HeadConflictError(subject, "aaa", "bbb");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(HeadConflictError);
    expect(e.name).toBe("HeadConflictError");
  });

  it("carries subject, expected and actual heads", () => {
    const e = new HeadConflictError(subject, "aaa", "bbb");
    expect(e.subject).toEqual(subject);
    expect(e.expected).toBe("aaa");
    expect(e.actual).toBe("bbb");
  });

  it("renders a null expected head as 'null (genesis)' and keeps the null field", () => {
    const e = new HeadConflictError(subject, null, "bbb");
    expect(e.expected).toBeNull();
    expect(e.actual).toBe("bbb");
    expect(e.message).toContain("null (genesis)");
  });

  it("renders a null actual head as 'null (genesis)' and keeps the null field", () => {
    const e = new HeadConflictError(subject, "aaa", null);
    expect(e.actual).toBeNull();
    expect(e.expected).toBe("aaa");
    expect(e.message).toContain("null (genesis)");
  });
});
