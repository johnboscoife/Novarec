import type { ReactElement } from 'react';

/** The NovaRec brand mark: a record aperture with a nova spark. */
export function LogoMark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="NovaRec">
      <defs>
        <linearGradient id="nova-g" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#nova-g)" />
      <circle cx="22" cy="24" r="10" stroke="#ffffff" strokeWidth="2.6" opacity="0.92" />
      <circle cx="22" cy="24" r="4.6" fill="#ef4444" />
      <path
        d="M37 6 L38.7 10.3 L43 12 L38.7 13.7 L37 18 L35.3 13.7 L31 12 L35.3 10.3 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** Mark + wordmark, for the nav header and onboarding. */
export function LogoWordmark({ markSize = 30 }: { markSize?: number }): ReactElement {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={markSize} />
      <span className="text-lg font-semibold tracking-tight text-app">NovaRec</span>
    </span>
  );
}
