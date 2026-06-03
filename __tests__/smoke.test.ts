// __tests__/smoke.test.ts
import { describe, it, expect } from "vitest";
import * as core from "../index.js";

describe("@symblon/core harness", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});

describe("@symblon/core public API", () => {
  it("exports the disclosure primitives", () => {
    expect(typeof core.commitField).toBe("function");
    expect(typeof core.verifyOpening).toBe("function");
    expect(typeof core.currentController).toBe("function");
    expect(typeof core.currentCommitments).toBe("function");
    expect(typeof core.buildPresentation).toBe("function");
    expect(typeof core.verifyPresentation).toBe("function");
  });
});
