import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function StudioView(): ReactElement {
  return (
    <Placeholder
      tagline="Studio"
      title="OBS's engine, Clipchamp's front door"
      description="Scene-based live compositing, virtual camera, and multi-destination streaming, sharing the same compositor as Record and Meet. The scene, compositor, and streaming engines are ready; the live studio UI is coming soon."
      ctaLabel="Coming soon"
    />
  );
}
