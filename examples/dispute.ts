// examples/dispute.ts
//
// Blueberry rejection + grower counter-claim, end-to-end.
// A wholesaler rejects a lot on its (custody-passed) lot chain; the grower —
// no longer the lot's controller — records a dispute on their OWN party chain,
// referencing the exact rejection. verifyReference confirms the tamper-binding
// link. Run: npm run example:dispute
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  buildAttestation,
  signAttestation,
  verifyReference,
  reference,
  DISPUTES,
  type Attestation,
  type AttestationInput,
  type Signer,
  type PublicKeyResolver,
  type Subject,
} from "../index.js";

const T = "2026-06-26T00:00:00.000Z";

function key(keyId: string) {
  const priv = ed25519.utils.randomPrivateKey();
  return { keyId, priv, pub: ed25519.getPublicKey(priv) };
}
function signerFor(k: { keyId: string; priv: Uint8Array }): Signer {
  return { keyId: k.keyId, sign: async (m) => bytesToHex(ed25519.sign(utf8ToBytes(m), k.priv)) };
}

async function link(
  k: { keyId: string; priv: Uint8Array },
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: subject.scheme, id: "demo", keyId: k.keyId },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(k), T);
}

const lotKey = key("lot-signer");
const growerKey = key("grower-7");
const resolver: PublicKeyResolver = async (id) =>
  id === lotKey.keyId ? lotKey.pub : id === growerKey.keyId ? growerKey.pub : null;

const lot: Subject = { scheme: "agropass.lot", id: "BB-123" };
const party: Subject = { scheme: "agropass.party", id: "grower-7" };

const g1 = await link(lotKey, lot, null, { id: "g1", type: "harvest", claim: { species: "blueberry" } });
const rejection = await link(lotKey, lot, g1, {
  id: "w2",
  type: "quality_rejection",
  claim: { grade: "C", reason: "mold" },
});

const dispute = await link(growerKey, party, null, {
  id: "d1",
  type: "counter_claim",
  claim: { note: "I dispute the mold finding", references: [reference(DISPUTES, rejection)] },
});

const result = await verifyReference([dispute], [g1, rejection], resolver);
console.log("dispute references the rejection, tamper-binding verified:", result);
