import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function StudioView(): ReactElement {
  return (
    <Placeholder
      tagline="Studio"
      title="OBS's engine, Clipchamp's front door"
      description="Scene-based live compositing, virtual camera, and multi-destination streaming, sharing the same compositor as Record and Meet."
      ctaLabel="Coming soon"
      features={[
        { label: 'Scene model & compositor engine', done: true },
        { label: 'Streaming engine (RTMP, multi-destination)', done: true },
        { label: 'Virtual-camera plumbing', done: true },
        { label: 'Live studio canvas & scene switching', done: false },
        { label: 'Sources & overlays panel', done: false },
      ]}
    />
  );
}
