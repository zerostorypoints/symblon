// index.ts
export type {
  Subject,
  Issuer,
  Proof,
  Attestation,
  UnsignedAttestation,
  AttestationInput,
  CustodyChangeClaim,
} from "./types/attestation.js";
export { CUSTODY_CHANGE } from "./types/attestation.js";
export type { Signer, IntegritySubstrate, PublicKeyResolver } from "./types/seams.js";
export { AttestationSchema } from "./schemas/attestation.js";
export { canonicalize } from "./canonicalize.js";
export { sha256Hex } from "./hash.js";
export { buildAttestation, computePayloadHash } from "./build-attestation.js";
export { signAttestation } from "./sign-attestation.js";
export { verifyAttestation, type VerifyResult, type VerifyFailureReason } from "./verify-attestation.js";
export { verifyChain, type ChainVerification, type ChainFailureReason } from "./verify-chain.js";
export { computeMerkleRoot } from "./merkle.js";
export { commitField, verifyOpening } from "./commitments.js";
export { currentController, currentCommitments } from "./chain-state.js";
export {
  TRANSFORMATION,
  attestationRef,
  parseDerivedFrom,
  parseConsumedIn,
  type AttestationRef,
} from "./derivation.js";
export {
  verifyDerivation,
  type DerivationVerification,
  type DerivationFailureReason,
} from "./verify-derivation.js";
export {
  buildPresentation,
  verifyPresentation,
  type DisclosedField,
  type Presentation,
  type PresentationInput,
  type PresentationVerification,
  type PresentationFailureReason,
} from "./presentation.js";
