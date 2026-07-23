import type { ReactElement, ReactNode } from 'react';
import { Button } from '@novarec/ui';
import { useAppInfo } from './useAppInfo.js';

export interface PlaceholderFeature {
  label: string;
  done: boolean;
}

interface PlaceholderProps {
  title: string;
  tagline: string;
  description: string;
  ctaLabel: string;
  features?: readonly PlaceholderFeature[];
  children?: ReactNode;
}

export function Placeholder({
  title,
  tagline,
  description,
  ctaLabel,
  features,
  children,
}: PlaceholderProps): ReactElement {
  const { data } = useAppInfo();

  return (
    <section className="flex h-full flex-col overflow-auto p-10">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-app">{tagline}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-muted-app">{description}</p>

      {features && features.length > 0 && (
        <ul className="mt-6 max-w-xl space-y-2">
          {features.map((feature) => (
            <li key={feature.label} className="flex items-center gap-2 text-sm">
              <span
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  feature.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-surface2 text-dim-app'
                }`}
                aria-hidden
              >
                {feature.done ? '✓' : '•'}
              </span>
              <span className={feature.done ? 'text-app2' : 'text-muted-app'}>{feature.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Button
          disabled
          className="cursor-not-allowed rounded-lg bg-surface2 px-4 py-2 text-sm font-medium text-muted-app"
        >
          {ctaLabel}
        </Button>
      </div>

      {children}

      <footer className="mt-auto flex items-center gap-2 pt-8 text-xs text-dim-app">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        {data
          ? `${data.name} ${data.version} · Electron ${data.electronVersion} · Chromium ${data.chromeVersion} · ${data.platform}`
          : 'Connecting to main process…'}
      </footer>
    </section>
  );
}
