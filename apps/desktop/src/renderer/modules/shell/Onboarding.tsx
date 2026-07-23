import type { ReactElement } from 'react';
import { LogoMark } from '../../components/Logo.js';

/** First-run welcome — gets a new user to their first recording fast. */
export function Onboarding({ onStart }: { onStart: () => void }): ReactElement {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-app p-8">
      <div className="max-w-md text-center">
        <div className="mb-5 flex justify-center">
          <LogoMark size={56} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to NovaRec</h1>
        <p className="mt-3 leading-relaxed text-muted-app">
          A professional screen recorder that never loses your work. Pick a screen, hit record, and
          export in one click.
        </p>
        <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-muted-app">
          <li>• Crash-proof recording — nothing is ever lost</li>
          <li>• Multi-track: screen, camera, mic, system audio</li>
          <li>• One-click export to MP4</li>
        </ul>
        <button
          type="button"
          onClick={onStart}
          className="mt-8 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          Start recording
        </button>
      </div>
    </div>
  );
}
