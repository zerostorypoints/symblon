// schemas/attestation.ts
import { z } from "zod";
import type { Attestation } from "../types/attestation.js";

const subjectSchema = z.object({ scheme: z.string().min(1), id: z.string().min(1) });
const issuerSchema = z.object({
  scheme: z.string().min(1),
  id: z.string().min(1),
  keyId: z.string().min(1),
});
const proofSchema = z.object({
  type: z.literal("ed25519-jcs-2022"),
  keyId: z.string().min(1),
  created: z.string().min(1),
  signature: z.string().regex(/^[0-9a-f]+$/, "signature must be lowercase hex"),
});

export const AttestationSchema = z.object({
  id: z.string().min(1),
  subject: subjectSchema,
  issuer: issuerSchema,
  type: z.string().min(1),
  claim: z.unknown(),
  assurance: z.string().min(1).optional(),
  commitments: z.record(z.string().regex(/^[0-9a-f]{64}$/)).optional(),
  occurredAt: z.string().min(1),
  recordedAt: z.string().min(1),
  prevHash: z.string().nullable(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/, "payloadHash must be 64-char hex"),
  proof: proofSchema,
});

// Schema-type drift guard — bidirectional, per CLAUDE.md hard rule 5.
// Both directions use `satisfies` so TypeScript checks every field except `claim`.
// The single relaxation: z.unknown() under exactOptionalPropertyTypes causes Zod's
// inferred type to mark `claim` as optional (`claim?: unknown`), conflicting with
// `Attestation.claim: unknown` (required). This is a Zod 3 + exactOptionalPropertyTypes
// quirk. Both guards therefore use `Omit<…, "claim"> & { claim?: unknown }` to confine
// the concession to that one field — all other fields remain drift-protected in both
// directions.
const _schemaToType = ({} as z.infer<typeof AttestationSchema>) satisfies Omit<Attestation, "claim"> & { claim?: unknown };
const _typeToSchema = ({} as Attestation) satisfies Omit<z.infer<typeof AttestationSchema>, "claim"> & { claim?: unknown };
void _schemaToType;
void _typeToSchema;
