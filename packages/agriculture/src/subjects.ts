// subjects.ts
import type { Subject } from "@symblon/core";

/** Subject scheme for a lot chain — the goods, custody baton-passed
 *  (grower → wholesaler → retailer) along one continuous track-and-trace timeline. */
export const LOT_SCHEME = "agriculture.lot" as const;

/** Subject scheme for a party chain — an actor's own sovereign ledger, where it
 *  records statements (e.g. counter-claims) about chains it does not control. */
export const PARTY_SCHEME = "agriculture.party" as const;

/** Build a lot subject (the goods). */
export function lotSubject(id: string): Subject {
  return { scheme: LOT_SCHEME, id };
}

/** Build a party subject (an actor's sovereign chain). */
export function partySubject(id: string): Subject {
  return { scheme: PARTY_SCHEME, id };
}
