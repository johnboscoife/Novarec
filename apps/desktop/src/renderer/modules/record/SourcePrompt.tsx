import { useEffect, useState, type ReactElement } from 'react';
import type { DisplayInfo, SourceList } from '@novarec/shared';

type Tab = 'screen' | 'window' | 'area';

export interface SourcePromptProps {
  screens: SourceList['screens'];
  windows: SourceList['windows'];
  displays: readonly DisplayInfo[];
  /** Why sources couldn't be listed (e.g. macOS Screen Recording permission). */
  error: unknown;
  loading: boolean;
  /** Region selection is available (feature flag and at least one screen). */
  areaEnabled: boolean;
  /** A microphone or system audio is on, so an audio-only take is possible. */
  audioOnlyAvailable: boolean;
  onRetry: () => void;
  onPickScreen: (sourceId: string) => void;
  onPickWindow: (sourceId: string) => void;
  onPickArea: () => void;
  onAudioOnly: () => void;
  onCancel: () => void;
}

/**
 * Asked when Record is pressed with nothing visual chosen: what should this
 * take capture? Choosing starts the recording. Without this a take with only
 * the mic on silently recorded sound alone and looked like a finished video.
 */
export function SourcePrompt(props: SourcePromptProps): ReactElement {
  const { screens, windows, displays, error, loading, areaEnabled, audioOnlyAvailable } = props;
  const [tab, setTab] = useState<Tab>('screen');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const message = error
    ? (error instanceof Error ? error.message : String(error)).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      )
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-prompt-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
      onClick={props.onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-app bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="source-prompt-title" className="text-lg font-semibold">
          What do you want to record?
        </h2>
        <p className="mt-1 text-sm text-muted-app">Choose one — recording starts right after.</p>

        <div role="tablist" className="mt-4 flex gap-1 rounded-xl bg-surface2 p-1">
          <TabButton current={tab} value="screen" onSelect={setTab}>
            Entire screen
          </TabButton>
          <TabButton current={tab} value="window" onSelect={setTab}>
            A window
          </TabButton>
          {areaEnabled && (
            <TabButton current={tab} value="area" onSelect={setTab}>
              An area
            </TabButton>
          )}
        </div>

        <div className="mt-3 max-h-72 min-h-24 overflow-y-auto">
          {message ? (
            <div role="alert" className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
              {message}
              <button
                type="button"
                onClick={props.onRetry}
                className="mt-2 block rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-medium hover:bg-amber-500/20"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <p className="p-3 text-sm text-muted-app">Looking for screens and windows…</p>
          ) : tab === 'screen' ? (
            <OptionList
              empty="No screens found."
              items={screens.map((s) => {
                const d = displays.find((x) => x.id === s.displayId);
                return {
                  id: s.id,
                  title: s.name,
                  detail: d
                    ? `${d.bounds.width}×${d.bounds.height}${d.primary ? ' · primary' : ''}`
                    : '',
                };
              })}
              onPick={props.onPickScreen}
            />
          ) : tab === 'window' ? (
            <OptionList
              empty="No windows found."
              items={windows.slice(0, 60).map((w) => ({
                id: w.id,
                title: w.name || 'Untitled window',
                detail: '',
              }))}
              onPick={props.onPickWindow}
            />
          ) : (
            <div className="p-1">
              <p className="text-sm text-muted-app">
                Drag a rectangle over the part of the screen you want. Only that area is recorded.
              </p>
              <button
                type="button"
                onClick={props.onPickArea}
                disabled={screens.length === 0}
                className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:opacity-60"
              >
                Select an area
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          {audioOnlyAvailable ? (
            <button
              type="button"
              onClick={props.onAudioOnly}
              className="text-sm text-muted-app hover:text-app hover:underline"
            >
              Record audio only
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-lg bg-surface2 px-4 py-2 text-sm text-app2 hover:ring-1 hover:ring-app"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: Tab;
  value: Tab;
  onSelect: (tab: Tab) => void;
  children: string;
}): ReactElement {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-blue-600 text-white' : 'text-app2 hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}

function OptionList({
  items,
  empty,
  onPick,
}: {
  items: { id: string; title: string; detail: string }[];
  empty: string;
  onPick: (id: string) => void;
}): ReactElement {
  if (items.length === 0) return <p className="p-3 text-sm text-muted-app">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onPick(item.id)}
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface2 px-3.5 py-2.5 text-left text-sm ring-1 ring-inset ring-transparent transition hover:ring-blue-500/50"
          >
            <span className="truncate font-medium text-app2">{item.title}</span>
            {item.detail && <span className="shrink-0 text-xs text-muted-app">{item.detail}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
