// types/attestation.ts

/** What a passport is about. `scheme` is owned by the domain (e.g. 'hifisync.unit'). */
export type Subject = { scheme: string; id: string };

/** Who attests. `keyId` resolves to a public key for verification. */
export type Issuer = { scheme: string; id: string; keyId: string };

/** VC-shaped proof block. `type` is upgradeable to a full W3C cryptosuite later. */
export type Proof = {
  type: "ed25519-jcs-2022";
  keyId: string;
  /** ISO-8601 signing time (passed in — purity rule). */
  created: string;
  /** Lowercase hex Ed25519 signature over the UTF-8 bytes of `payloadHash`. */
  signature: string;
};

/** One signed link in a subject's append-only chain. */
export type Attestation = {
  /** Caller-supplied id (purity rule — never generated inside the engine). */
  id: string;
  subject: Subject;
  issuer: Issuer;
  /** Domain event type. The engine only special-cases `custody_change`. */
  type: string;
  /** Domain payload; validated by the domain's own Zod schema, opaque here. */
  claim: unknown;
  /** Domain assurance vocab (hifipass: 'channel' | 'receipt' | 'self'). */
  assurance?: string | undefined;
  /** Real-world event time (passed in). */
  occurredAt: string;
  /** Record time (passed in). */
  recordedAt: string;
  /** `payloadHash` of the prior attestation; null at genesis. */
  prevHash: string | null;
  /** Lowercase hex SHA-256 over canonicalize(content-sans-proof). */
  payloadHash: string;
  proof: Proof;
};

/** An attestation before signing — has its payloadHash, lacks its proof. */
export type UnsignedAttestation = Omit<Attestation, "proof">;

/** Caller input to `buildAttestation` — everything except the computed payloadHash and proof. */
export type AttestationInput = Omit<UnsignedAttestation, "payloadHash">;

/** Reserved event type the engine understands: it moves the controller key. */
export const CUSTODY_CHANGE = "custody_change" as const;

/** Claim shape for a `custody_change` attestation. `publicKey` is lowercase hex. */
export type CustodyChangeClaim = { newController: { keyId: string; publicKey: string } };
