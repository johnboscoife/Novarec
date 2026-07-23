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

/**
 * Google Meet link helpers. The Meet section lets a user start or join a real
 * Google Meet in their browser; these keep URL handling in one pure, tested spot
 * so the UI never opens anything but a genuine meet.google.com link.
 */
export const GOOGLE_MEET_HOST = 'meet.google.com';
export const NEW_GOOGLE_MEET_URL = `https://${GOOGLE_MEET_HOST}/new`;

/** The signed-in Google account shown in the Meet section. */
export const GoogleProfileSchema = z.object({
  email: z.string(),
  name: z.string(),
  picture: z.string().nullable(),
});
export type GoogleProfile = z.infer<typeof GoogleProfileSchema>;

/** A Meet code looks like `abc-defg-hij` (3-4-3 letters). */
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

/**
 * Turn user input (a full URL, a `meet.google.com/xxx` string, or a bare
 * `abc-defg-hij` code) into a canonical Google Meet URL, or null if it isn't a
 * valid Meet reference. Never returns a non-Meet host.
 */
export function normalizeMeetUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;

  if (/^https?:\/\//i.test(t)) {
    let url: URL;
    try {
      url = new URL(t);
    } catch {
      return null;
    }
    if (url.hostname !== GOOGLE_MEET_HOST && !url.hostname.endsWith(`.${GOOGLE_MEET_HOST}`)) {
      return null;
    }
    const code = url.pathname.replace(/^\/+/, '');
    if (code === 'new') return NEW_GOOGLE_MEET_URL;
    return MEET_CODE.test(code) ? `https://${GOOGLE_MEET_HOST}/${code}` : null;
  }

  const bare = t.startsWith(`${GOOGLE_MEET_HOST}/`) ? t.slice(GOOGLE_MEET_HOST.length + 1) : t;
  return MEET_CODE.test(bare) ? `https://${GOOGLE_MEET_HOST}/${bare}` : null;
}
