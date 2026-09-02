import { useEffect, useRef, type ReactElement } from 'react';
import { QrCode } from './QrCode.js';
import type { PhoneCamera } from './usePhoneCamera.js';

/**
 * Pairing UI for using a phone as the camera, with no third-party app: NovaRec
 * runs a short-lived local server, the phone scans the QR code and streams its
 * camera straight over the Wi-Fi.
 *
 * The certificate warning is called out up front rather than left as a surprise
 * — it is unavoidable (a self-signed cert is the only way to get the secure
 * context `getUserMedia` requires on a LAN address), and a user who is not
 * expecting it reasonably assumes something is broken.
 */
interface PhoneCameraPanelProps {
  phone: PhoneCamera;
  onDone: () => void;
}

export function PhoneCameraPanel({ phone, onDone }: PhoneCameraPanelProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && phone.stream) video.srcObject = phone.stream;
  }, [phone.stream]);

  return (
    <div className="rounded-2xl border border-app bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-app">
          Phone camera
        </h2>
        {phone.status !== 'idle' && (
          <button
            type="button"
            onClick={() => void phone.stop()}
            className="rounded-lg bg-surface2 px-3 py-1.5 text-xs text-app2 transition hover:text-app"
          >
            {phone.status === 'live' ? 'Disconnect' : 'Cancel'}
          </button>
        )}
      </div>

      {phone.status === 'idle' && (
        <>
          <p className="text-xs leading-relaxed text-muted-app">
            Use your phone as the camera — over Wi-Fi, or by USB cable. No app to install on either
            device. Your video goes straight from your phone to this computer and is never uploaded
            anywhere.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-dim-app">
            <span className="text-app2">By cable:</span> plug the phone in and turn on USB tethering
            (Android: Settings → Network → Hotspot &amp; tethering; iPhone: Personal Hotspot). That
            puts both devices on one network across the cable — steadier than Wi-Fi — and NovaRec
            offers that connection automatically.
          </p>
          <button
            type="button"
            onClick={() => void phone.start()}
            className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Connect a phone
          </button>
        </>
      )}

      {phone.status === 'starting' && <p className="text-sm text-muted-app">Starting…</p>}

      {(phone.status === 'waiting' || phone.status === 'connecting') && phone.url && (
        <div className="flex flex-col items-center">
          <QrCode value={phone.url} size={190} />
          <p className="mt-3 text-center text-xs leading-relaxed text-muted-app">
            Scan with your phone&apos;s camera, then tap the link.
          </p>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-amber-400">
            Your phone will warn that the connection isn&apos;t private — that is expected. Choose
            <span className="text-app2"> Advanced → Proceed</span>. The certificate is generated on
            this computer for this session only.
          </p>
          {phone.code && (
            <p className="mt-2 text-center text-xs text-dim-app">
              Pairing code <span className="font-mono text-app2">{phone.code}</span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-app">
            {phone.status === 'connecting'
              ? 'Phone found — connecting…'
              : 'Waiting for your phone…'}
          </p>

          {phone.addresses.length > 1 && (
            // Only the user knows which network the phone is actually on: a
            // tethered phone cannot reach the Wi-Fi address, and vice versa. So
            // offer the alternatives rather than insisting on the guess.
            <label className="mt-3 w-full text-xs text-muted-app">
              <span className="mb-1 block">Not connecting? Try a different connection:</span>
              <select
                value={phone.host ?? ''}
                onChange={(e) => void phone.start(e.target.value)}
                className="w-full rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
              >
                {phone.addresses.map((option) => (
                  <option key={option.address} value={option.address}>
                    {option.kind === 'usb'
                      ? 'USB cable'
                      : option.kind === 'wifi'
                        ? 'Wi-Fi'
                        : 'Network'}
                    {' · '}
                    {option.address} ({option.adapter})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {phone.status === 'live' && (
        <div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black"
            style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
          />
          <p className="mt-2 text-xs text-emerald-400">
            Phone camera live ✓ — it will be recorded as its own track and placed in the corner of
            your export.
          </p>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 transition hover:text-app"
          >
            Hide this preview
          </button>
        </div>
      )}

      {phone.error && <p className="mt-3 text-sm text-red-400">{phone.error}</p>}
    </div>
  );
}
