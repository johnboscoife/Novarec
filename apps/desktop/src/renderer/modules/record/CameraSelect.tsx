import { memo, useMemo, useState, type ReactElement } from 'react';
import { PHONE_WIFI_DEVICE_ID, groupCamerasByKind } from '@novarec/capture';
import type { CaptureSource } from '@novarec/shared';

/**
 * Camera picker that calls out phones explicitly.
 *
 * A phone used as a webcam reaches NovaRec through its companion app's virtual
 * camera driver, so it is already selectable — it just looks like one more
 * cryptic entry in a flat list. Grouping it under "Phone cameras", and telling
 * the user what to install when none is present, is what turns "supported in
 * principle" into "findable".
 *
 * A phone paired directly over Wi-Fi has no driver at all, so it is added to
 * the same "Phone cameras" group under its own sentinel device id — from the
 * user's side it is simply another camera to pick.
 */
const PHONE_APPS: readonly { name: string; url: string; note: string }[] = [
  {
    name: 'Iriun Webcam',
    url: 'https://iriun.com',
    note: 'Free · iOS & Android · Wi-Fi or USB',
  },
  {
    name: 'DroidCam',
    url: 'https://www.dev47apps.com',
    note: 'Free tier · Android & iOS',
  },
  {
    name: 'Camo',
    url: 'https://reincubate.com/camo/',
    note: 'Free tier · best image quality',
  },
];

interface CameraSelectProps {
  cameras: CaptureSource[];
  value: string | null;
  onChange: (id: string) => void;
  /** A phone paired over Wi-Fi, which has no OS device entry of its own. */
  wifiPhoneConnected: boolean;
}

export const CameraSelect = memo(function CameraSelect({
  cameras,
  value,
  onChange,
  wifiPhoneConnected,
}: CameraSelectProps): ReactElement {
  const [showHelp, setShowHelp] = useState(false);
  const grouped = useMemo(() => groupCamerasByKind(cameras, (c) => c.label), [cameras]);
  // A Wi-Fi phone is a camera source like any other from the user's point of
  // view, so it belongs IN this list — not only in its own preview panel.
  const hasPhone = grouped.phone.length > 0 || wifiPhoneConnected;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs text-muted-app">
        <span className="w-20 shrink-0">Camera</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 truncate rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
        >
          <option value="">Default device</option>
          {hasPhone && (
            <optgroup label="Phone cameras">
              {wifiPhoneConnected && (
                <option value={PHONE_WIFI_DEVICE_ID}>Phone over Wi-Fi (paired)</option>
              )}
              {grouped.phone.map((d) => (
                <option key={d.id} value={d.deviceId ?? d.id}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          )}
          {grouped.other.length > 0 && (
            <optgroup label={hasPhone ? 'Other cameras' : 'Cameras'}>
              {grouped.other.map((d) => (
                <option key={d.id} value={d.deviceId ?? d.id}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <div className="pl-[88px] text-xs">
        {hasPhone ? (
          <p className="text-emerald-400">
            {wifiPhoneConnected
              ? 'Phone paired over Wi-Fi ✓ — selected as your camera.'
              : 'Phone camera detected ✓ — pick it above to use your phone as the webcam.'}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            className="text-blue-400 hover:underline"
          >
            Use your phone as the camera {showHelp ? '▾' : '▸'}
          </button>
        )}
      </div>

      {showHelp && !hasPhone && (
        <div className="ml-[88px] rounded-lg bg-surface2 p-3 text-xs leading-relaxed text-muted-app">
          <p>
            On <span className="text-app2">Windows 11</span>, nothing to install: pair your phone in{' '}
            <span className="text-app2">Settings → Bluetooth &amp; devices → Mobile devices</span>{' '}
            and turn on <span className="text-app2">Use as a connected camera</span>. It then
            appears here as your phone&apos;s name.
          </p>
          <p className="mt-2">
            Otherwise, install one of these on <span className="text-app2">both</span> your phone
            and this PC, connect them over Wi-Fi, then reopen this list — the phone appears as a
            camera under <span className="text-app2">Phone cameras</span>.
          </p>
          <ul className="mt-2 space-y-1.5">
            {PHONE_APPS.map((app) => (
              <li key={app.url} className="flex items-baseline justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void window.novarec.openExternal({ url: app.url })}
                  className="shrink-0 text-blue-400 hover:underline"
                >
                  {app.name} →
                </button>
                <span className="min-w-0 truncate text-right text-dim-app">{app.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-dim-app">
            NovaRec has no affiliation with these apps. To skip them entirely, use{' '}
            <span className="text-app2">Connect a phone</span> to pair directly over Wi-Fi.
          </p>
        </div>
      )}
    </div>
  );
});
