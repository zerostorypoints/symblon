/**
 * Agro batch traceability — a runnable, copy-pasteable example.
 *
 * Run it:  npm run example:agro   (or: npx tsx examples/agro-batch.ts)
 *
 * The agricultural-traceability shape (spec §7): two raw fruit batches are delivered
 * (suppliers + prices COMMITTED, never cleartext), then consumed to produce
 * one finished-good batch via derivation links. `verifyDerivation` proves the
 * lineage; tampering with any input delivery breaks it. A Presentation then
 * selectively opens ONE committed field (the price) to an auditor.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  attestationRef,
  buildAttestation,
  buildPresentation,
  commitField,
  signAttestation,
  TRANSFORMATION,
  verifyDerivation,
  verifyPresentation,
  type Attestation,
  type AttestationInput,
  type PublicKeyResolver,
  type Signer,
  type Subject,
} from "../index.js";

// --- consumer-owned key custody (the engine never sees a private key) ---
type Key = { id: string; priv: Uint8Array; pub: Uint8Array };
function makeKey(id: string): Key {
  const priv = ed25519.utils.randomPrivateKey();
  return { id, priv, pub: ed25519.getPublicKey(priv) };
}
function signerFor(k: Key): Signer {
  return { keyId: k.id, sign: async (msg) => bytesToHex(ed25519.sign(utf8ToBytes(msg), k.priv)) };
}
function resolverFor(keys: Key[]): PublicKeyResolver {
  const map = new Map(keys.map((k) => [k.id, k.pub]));
  return async (id) => map.get(id) ?? null;
}

const T = "2026-06-11T06:00:00.000Z"; // times are passed in — the engine is pure

async function link(
  signerKey: Key,
  subject: Subject,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim" | "assurance" | "commitments">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "agro.producer", id: "producer-77", keyId: signerKey.id },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(signerKey), T);
}

async function main(): Promise<void> {
  const producer = makeKey("producer-77:v1"); // custodial signer (Phase 0)
  const resolver = resolverFor([producer]);

  // Subjects: producers keep their semantic batch codes (spec §3).
  const rawA: Subject = { scheme: "agro.batch", id: "producer-77:1011125-09561" };
  const rawB: Subject = { scheme: "agro.batch", id: "producer-77:1011125-01111" };
  const fg: Subject = { scheme: "agro.batch", id: "producer-77:36441715251" };

  // 1) Two deliveries (PZ). Public claim: species/origin/quality.
  //    Committed: supplier + price (salts are caller-supplied entropy).
  const a1 = await link(producer, rawA, null, {
    id: "pz-101",
    type: "delivery_received",
    claim: { species: "blueberry", origin: "PL", quality: "101" },
    assurance: "documented",
    commitments: {
      supplier: commitField("Farm Kowalski, GGN 4056186000001", "salt-a-sup"),
      pricePlnKg: commitField(18.5, "salt-a-price"),
    },
  });
  const b1 = await link(producer, rawB, null, {
    id: "pz-102",
    type: "delivery_received",
    claim: { species: "blueberry", origin: "PL", quality: "102" },
    assurance: "documented",
    commitments: {
      supplier: commitField("Farm Nowak, GGN 4056186000002", "salt-b-sup"),
      pricePlnKg: commitField(16.0, "salt-b-price"),
    },
  });

  // 2) Transformation (ZP): output genesis FIRST — it pins the consumed
  //    input states by ref...
  const genesis = await link(producer, fg, null, {
    id: "zp-77",
    type: "transformation",
    claim: {
      product: "Borówka 250g KRAJ POCHODZENIA POLSKA",
      derivedFrom: [attestationRef(a1), attestationRef(b1)],
    },
  });
  //    ...then each input chain records the consumption, pinning the genesis.
  const a2 = await link(producer, rawA, a1, {
    id: "pz-101-zp77",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });
  const b2 = await link(producer, rawB, b1, {
    id: "pz-102-zp77",
    type: TRANSFORMATION,
    claim: { consumedIn: attestationRef(genesis) },
  });

  // 3) Verify the lineage: finished batch ← both raw batches.
  const ok = await verifyDerivation([genesis], [[a1, a2], [b1, b2]], resolver);
  console.log("derivation verifies:", ok); // { ok: true }

  // 4) Tamper with one delivery (silently change the quality grade) → caught,
  //    and the failure names the exact input batch.
  const tampered = { ...a1, claim: { species: "blueberry", origin: "PL", quality: "103" } };
  const bad = await verifyDerivation([genesis], [[tampered, a2], [b1, b2]], resolver);
  console.log("tampered input:", bad); // { ok: false, reason: 'input-chain-invalid', inputSubjectId: ... }

  // 5) Selective disclosure: open ONLY raw-A's price to an auditor.
  //    The supplier commitment stays closed.
  const presentation = await buildPresentation(
    {
      subject: rawA,
      nonce: "audit-nonce-1",
      expiresAt: "2026-06-12T06:00:00.000Z",
      disclosed: [{ name: "pricePlnKg", value: 18.5, salt: "salt-a-price" }],
    },
    signerFor(producer),
    T,
  );
  const audit = await verifyPresentation(presentation, [a1, a2], resolver, T);
  console.log("auditor verifies the opened price:", audit); // { ok: true }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
