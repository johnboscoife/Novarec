import type { ReactElement } from 'react';
import { Placeholder } from '../shell/Placeholder.js';

export function RecordView(): ReactElement {
  return (
    <Placeholder
      tagline="Record"
      title="A screen recorder, done right"
      description="What Clipchamp should have been. The shared capture engine — region selection, multi-monitor, selectable FPS — arrives in Phase 1."
      ctaLabel="New recording (Phase 1)"
    />
  );
}
