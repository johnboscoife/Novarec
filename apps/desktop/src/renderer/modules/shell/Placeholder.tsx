import type { ReactElement, ReactNode } from 'react';
import { Button } from '@novarec/ui';
import { useAppInfo } from './useAppInfo.js';

interface PlaceholderProps {
  title: string;
  tagline: string;
  description: string;
  ctaLabel: string;
  children?: ReactNode;
}

export function Placeholder({
  title,
  tagline,
  description,
  ctaLabel,
  children,
}: PlaceholderProps): ReactElement {
  const { data } = useAppInfo();

  return (
    <section className="flex h-full flex-col p-10">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{tagline}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-neutral-400">{description}</p>

      <div className="mt-6">
        <Button
          disabled
          className="cursor-not-allowed rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-400"
        >
          {ctaLabel}
        </Button>
      </div>

      {children}

      <footer className="mt-auto flex items-center gap-2 pt-8 text-xs text-neutral-600">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        {data
          ? `${data.name} ${data.version} · Electron ${data.electronVersion} · Chromium ${data.chromeVersion} · ${data.platform}`
          : 'Connecting to main process…'}
      </footer>
    </section>
  );
}
