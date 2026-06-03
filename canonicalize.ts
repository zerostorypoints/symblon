// packages/passport-core/canonicalize.ts

/**
 * Deterministic JSON serialization: recursively sorted object keys, undefined
 * keys omitted, non-finite numbers rejected. The byte-stable substrate that
 * payloadHash and signatures depend on. (RFC 8785 JCS is the eventual target
 * for cross-implementation parity; this stable-stringify is sufficient for
 * intra-system determinism in Phase 0.)
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") {
    if (!Number.isFinite(v)) throw new Error("canonicalize: non-finite number");
    return JSON.stringify(v);
  }
  if (t === "string" || t === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(serialize).join(",") + "]";
  if (t === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + serialize(obj[k])).join(",") + "}";
  }
  throw new Error(`canonicalize: unsupported type ${t}`);
}
