/**
 * Feature flags for staged or suspended features. Flip a flag to bring the
 * feature back — the code stays in the build, just hidden from the UI.
 */

/** Google Meet integration (sign-in, create/join). Suspended for now. */
export const GOOGLE_MEET_ENABLED: boolean = false;

/**
 * Region capture (crop the recording to a picked rectangle). The picker and its
 * geometry engine exist, but the crop is not yet applied to the recorded/exported
 * video — shipping the control would silently record the full screen instead of
 * the region. Hidden until the crop is wired end-to-end so it never lies.
 */
export const REGION_CAPTURE_ENABLED: boolean = false;
