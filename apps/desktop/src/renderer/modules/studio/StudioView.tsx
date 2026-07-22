import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function StudioView(): ReactElement {
  return (
    <Placeholder
      tagline="Studio"
      title="OBS's engine, Clipchamp's front door"
      description="Scene-based live compositing, virtual camera, and multi-destination streaming — sharing the same compositor as Record and Meet. Arrives in Phase 9."
      ctaLabel="Open scene collection (Phase 9)"
    />
  );
}
