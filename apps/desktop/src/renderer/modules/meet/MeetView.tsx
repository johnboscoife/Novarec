import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function MeetView(): ReactElement {
  return (
    <Placeholder
      tagline="Meet"
      title="Meetings that record like a studio"
      description="Multi-party video with per-participant tracks and local-first recording. Built on the same capture pipeline as Record. Arrives in Phase 8."
      ctaLabel="Start a meeting (Phase 8)"
    />
  );
}
