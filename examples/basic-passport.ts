/**
 * Basic passport lifecycle — a runnable, copy-pasteable example.
 *
 * Run it:  pnpm example   (or: npx tsx examples/basic-passport.ts)
 *
 * Shows the whole engine as a black box: build a passport's chain
 * (mint → transfer → custody handover → transfer by the new owner),
 * verify it, then prove tamper- and forgery-evidence.
 *
 * The engine owns NO keys and NO storage. The consumer supplies a `Signer`
 * (key custody) and a `PublicKeyResolver` (key lookup) — here, in-memory
 * Ed25519 helpers. In a real app these are a KMS/secure-enclave signer and a
 * key registry. This example imports via the relative path; in your own
 * project you would `import { ... } from "@symblon/core"`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  buildAttestation,
  signAttestation,
  verifyChain,
  sha256Hex,
  CUSTODY_CHANGE,
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

// --- helper to append one signed, hash-linked attestation to a subject's chain ---
const subject: Subject = { scheme: "example.unit", id: `amp-h120:${sha256Hex("SN-9920")}` };
const T = "2026-06-03T10:00:00.000Z"; // times are passed in — the engine is pure

async function link(
  signerKey: Key,
  prev: Attestation | null,
  partial: Pick<AttestationInput, "id" | "type" | "claim" | "assurance">,
): Promise<Attestation> {
  const input: AttestationInput = {
    ...partial,
    subject,
    issuer: { scheme: "example.platform", id: "platform", keyId: signerKey.id },
    occurredAt: T,
    recordedAt: T,
    prevHash: prev ? prev.payloadHash : null,
  };
  return signAttestation(buildAttestation(input), signerFor(signerKey), T);
}

async function main(): Promise<void> {
  const platform = makeKey("platform:v1"); // custodial signer (rung 0)
  const phone = makeKey("device:alice-phone"); // owner graduates to self-custody (rung 2)

  // 1) Build the chain.
  const mint = await link(platform, null, { id: "a1", type: "mint", claim: { owner_user_id: "alice" }, assurance: "channel" });
  const toBob = await link(platform, mint, { id: "a2", type: "transfer", claim: { to_user_id: "bob" } });
  const handover = await link(platform, toBob, {
    id: "a3",
    type: CUSTODY_CHANGE,
    claim: { newController: { keyId: phone.id, publicKey: bytesToHex(phone.pub) } },
  });
  const toCarol = await link(phone, handover, { id: "a4", type: "transfer", claim: { to_user_id: "carol" } });

  const chain = [mint, toBob, handover, toCarol];
  const resolver = resolverFor([platform, phone]);

  console.log("\n  @symblon/core — basic example\n");
  console.log(`  subject:      ${subject.id}`);
  console.log(`  chain:        mint → transfer → custody_change → transfer-by-new-owner (${chain.length} links)`);

  // 2) Verify the intact chain.
  const intact = await verifyChain(chain, resolver);
  console.log(`\n  intact chain                  -> ${JSON.stringify(intact)}`);

  // 3) Tamper-evidence: rewrite a past record. The hash-link breaks at that exact index.
  const tampered = chain.map((a) => (a.id === "a2" ? { ...a, claim: { to_user_id: "mallory" } } : a));
  const broken = await verifyChain(tampered, resolver);
  console.log(`  after rewriting record a2     -> ${JSON.stringify(broken)}`);

  // 4) Forgery-evidence: the OLD platform key tries to keep signing after the handover.
  const usurp = await link(platform, handover, { id: "a4x", type: "transfer", claim: { to_user_id: "eve" } });
  const usurped = await verifyChain([mint, toBob, handover, usurp], resolver);
  console.log(`  old key signing post-handover -> ${JSON.stringify(usurped)}`);

  const pass = intact.ok && !broken.ok && !usurped.ok;
  console.log(`\n  ${pass ? "OK — intact verifies; tampering and forgery are both detected." : "UNEXPECTED RESULT"}\n`);
  if (!pass) process.exitCode = 1;
}

void main();
