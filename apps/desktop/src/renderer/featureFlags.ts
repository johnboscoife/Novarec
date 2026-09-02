/**
 * Feature flags for staged or suspended features. Flip a flag to bring the
 * feature back — the code stays in the build, just hidden from the UI.
 */

/** Google Meet integration (sign-in, create/join). Suspended for now. */
export const GOOGLE_MEET_ENABLED: boolean = false;

/**
 * Region capture (crop the recording to a picked rectangle). The crop is applied
 * to the captured frames before they reach the encoder (`cropStream.ts`), so the
 * recording — and therefore the export — really is just the picked area. Enabled.
 */
export const REGION_CAPTURE_ENABLED: boolean = true;
