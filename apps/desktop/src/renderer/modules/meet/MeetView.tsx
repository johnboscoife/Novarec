import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function MeetView(): ReactElement {
  return (
    <Placeholder
      tagline="Meet"
      title="Meetings that record like a studio"
      description="Multi-party video with per-participant tracks and local-first recording, built on the same capture pipeline as Record. The signaling and consent engine is ready; the live meeting experience is coming soon."
      ctaLabel="Coming soon"
    />
  );
}
