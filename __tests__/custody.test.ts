import { describe, it, expect } from "vitest";
import { parseNewController } from "../custody.js";

const HEX64 = "a".repeat(64);

describe("parseNewController", () => {
  it("parses a well-formed custody_change claim", () => {
    expect(parseNewController({ newController: { keyId: "device-1", publicKey: HEX64 } }))
      .toEqual({ keyId: "device-1", publicKey: HEX64 });
  });

  it("returns null for missing/empty/malformed shapes", () => {
    expect(parseNewController(null)).toBeNull();
    expect(parseNewController({})).toBeNull();
    expect(parseNewController({ newController: null })).toBeNull();
    expect(parseNewController({ newController: { keyId: "", publicKey: HEX64 } })).toBeNull();
    expect(parseNewController({ newController: { keyId: "device-1", publicKey: "xyz" } })).toBeNull();
    expect(parseNewController({ newController: { keyId: "device-1" } })).toBeNull();
  });
});
