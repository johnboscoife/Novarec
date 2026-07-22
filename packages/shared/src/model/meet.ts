import { z } from 'zod';

/**
 * Meeting model. The consent ledger enforces the non-negotiable rule that
 * meeting recording requires affirmative consent from every participant, and
 * that consent state is logged. Pure so it's unit-tested.
 */
export const RoomRoleSchema = z.enum(['host', 'participant']);
export type RoomRole = z.infer<typeof RoomRoleSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoomRoleSchema,
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const TokenRequestSchema = z.object({
  room: z.string().min(1),
  identity: z.string().min(1),
  name: z.string().optional(),
  role: RoomRoleSchema,
});
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const TokenResponseSchema = z.object({
  token: z.string(),
  room: z.string(),
  url: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export interface ConsentEntry {
  consented: boolean;
  atMs: number;
}
export type ConsentLedger = Record<string, ConsentEntry>;

/** Log a participant's consent decision (append-style, last write wins). */
export function recordConsent(
  ledger: ConsentLedger,
  participantId: string,
  consented: boolean,
  atMs: number,
): ConsentLedger {
  return { ...ledger, [participantId]: { consented, atMs } };
}

/** Recording may start only when EVERY current participant has consented. */
export function allConsented(ledger: ConsentLedger, participantIds: readonly string[]): boolean {
  if (participantIds.length === 0) return false;
  return participantIds.every((id) => ledger[id]?.consented === true);
}

/** Participants who have not yet affirmatively consented (for the banner). */
export function pendingConsent(ledger: ConsentLedger, participantIds: readonly string[]): string[] {
  return participantIds.filter((id) => ledger[id]?.consented !== true);
}
