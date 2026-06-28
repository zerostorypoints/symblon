// dispute.ts
import { z } from "zod";
import {
  DISPUTES,
  reference,
  parseReferences,
  type Attestation,
  type AttestationRef,
  type Reference,
} from "@symblon/core";

/** agropass event type for a counter-claim attestation recorded on a party
 *  chain (the disputing actor's sovereign ledger). */
export const COUNTER_CLAIM = "counter_claim" as const;

/** The claim a party records when it disputes another chain's attestation:
 *  an optional human-readable note plus one or more `disputes` references
 *  (the engine-reserved `references` key) tamper-bindingly pinning the
 *  contested attestation(s). */
export type CounterClaimClaim = {
  note?: string;
  references: Reference[];
};

/** Build a counter-claim claim disputing `contested`. The engine pins the
 *  contested attestation by its exact `payloadHash` via `reference()`, so the
 *  dispute cannot be silently re-pointed at different content. */
export function disputeClaim(contested: Attestation, note?: string): CounterClaimClaim {
  const references = [reference(DISPUTES, contested)];
  return note === undefined ? { references } : { note, references };
}

const attestationRefSchema = z.object({
  subject: z.object({ scheme: z.string().min(1), id: z.string().min(1) }),
  attestationId: z.string().min(1),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/, "payloadHash must be 64-char hex"),
});

const referenceSchema = z.object({ rel: z.string().min(1), ref: attestationRefSchema });

/** Validates the structure of a counter-claim claim: an optional note and a
 *  non-empty `references` list carrying at least one `disputes` relationship. */
export const CounterClaimClaimSchema = z
  .object({
    note: z.string().min(1).optional(),
    references: z.array(referenceSchema).min(1),
  })
  .refine((c) => c.references.some((r) => r.rel === DISPUTES), {
    message: "a counter-claim must carry at least one `disputes` reference",
  });

// Schema-type drift guard (CLAUDE rule 5): the schema mirrors the type, never
// replaces it. The single relaxation confines the Zod-3 + exactOptionalPropertyTypes
// quirk: z.string().optional() infers `note?: string | undefined`, conflicting with
// `CounterClaimClaim.note: string?` (present-or-absent, never explicit undefined) —
// the same concession @symblon/core's AttestationSchema makes for `claim`.
type SchemaInferred = z.infer<typeof CounterClaimClaimSchema>;
const _schemaToType = (s: Omit<SchemaInferred, "note"> & { note?: string }): CounterClaimClaim => s;
void _schemaToType;

/** Extract the attestation refs a counter-claim disputes (rel === DISPUTES),
 *  or `null` if the claim carries no valid `disputes` reference. Builds on the
 *  engine's `parseReferences`. */
export function disputedRefs(claim: unknown): AttestationRef[] | null {
  const refs = parseReferences(claim);
  if (!refs) return null;
  const disputed = refs.filter((r) => r.rel === DISPUTES).map((r) => r.ref);
  return disputed.length > 0 ? disputed : null;
}
