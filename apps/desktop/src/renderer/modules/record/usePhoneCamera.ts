import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Receives a phone's camera over the LAN as a `MediaStream`.
 *
 * Main runs the local HTTPS server the phone's browser talks to, but it only
 * relays signalling — the peer connection, and therefore all media, lives here
 * in the renderer. The phone is the offerer (it owns the camera); this side
 * answers. No STUN/TURN is configured: both devices are on the same network, so
 * host candidates connect directly and no traffic ever leaves the LAN.
 */
export type PhoneStatus = 'idle' | 'starting' | 'waiting' | 'connecting' | 'live' | 'error';

export interface LanAddressOption {
  address: string;
  adapter: string;
  kind: 'usb' | 'wifi' | 'ethernet' | 'other';
}

export interface PhoneCamera {
  status: PhoneStatus;
  /** The pairing URL to render as a QR code (null until the server is up). */
  url: string | null;
  /** Short code shown on both screens so the user can confirm the device. */
  code: string | null;
  stream: MediaStream | null;
  error: string | null;
  /** Addresses the phone could reach this machine at, best first. */
  addresses: LanAddressOption[];
  /** The one currently advertised in the QR code. */
  host: string | null;
  start: (host?: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function usePhoneCamera(): PhoneCamera {
  const [status, setStatus] = useState<PhoneStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<LanAddressOption[]>([]);
  const [host, setHost] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Candidates can arrive before the remote description is set; hold them.
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);

  const teardown = useCallback((): void => {
    pcRef.current?.close();
    pcRef.current = null;
    pendingIce.current = [];
    setStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    teardown();
    setStatus('idle');
    setUrl(null);
    setCode(null);
    setError(null);
    await window.novarec.stopPhoneSession().catch(() => undefined);
  }, [teardown]);

  const handleOffer = useCallback(async (sdp: string): Promise<void> => {
    setStatus('connecting');
    // A repeat offer means the phone reconnected (page reload, dropped link).
    // The previous peer connection is dead; keeping it would leave its frozen
    // last frame on screen and leak the old track.
    pcRef.current?.close();
    pendingIce.current = [];
    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      // Ignore a track arriving from a connection we have already replaced.
      if (pcRef.current !== pc) return;
      const [incoming] = event.streams;
      if (incoming) {
        setStream(incoming);
        setStatus('live');
      }
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void window.novarec
        .sendPhoneIce({ candidate: event.candidate.toJSON() })
        .catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return; // superseded by a reconnect
      if (pc.connectionState === 'failed') {
        setError('The phone could not connect. Check both devices are on the same Wi-Fi.');
        setStatus('error');
      }
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const candidate of pendingIce.current.splice(0)) {
      await pc.addIceCandidate(candidate).catch(() => undefined);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await window.novarec.sendPhoneAnswer({ sdp: answer.sdp ?? '' });
  }, []);

  // Signalling and lifecycle messages relayed from the phone by main.
  const offerHandler = useRef(handleOffer);
  offerHandler.current = handleOffer;
  useEffect(() => {
    return window.novarec.onPhoneEvent((event) => {
      if (event.type === 'offer') {
        void offerHandler.current(event.sdp).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Could not accept the phone connection');
          setStatus('error');
        });
      } else if (event.type === 'ice') {
        const candidate = event.candidate as RTCIceCandidateInit;
        const pc = pcRef.current;
        if (pc?.remoteDescription) void pc.addIceCandidate(candidate).catch(() => undefined);
        else pendingIce.current.push(candidate);
      } else if (event.type === 'disconnected') {
        teardown();
        setStatus('waiting');
      } else if (event.type === 'expired') {
        teardown();
        setStatus('idle');
        setUrl(null);
        setCode(null);
        setError('The pairing code expired. Start again when you are ready.');
      }
    });
  }, [teardown]);

  const start = useCallback(async (preferredHost?: string): Promise<void> => {
    setError(null);
    setStatus('starting');
    try {
      const session = await window.novarec.startPhoneSession(
        preferredHost ? { host: preferredHost } : undefined,
      );
      setUrl(session.url);
      setCode(session.code);
      setAddresses(session.addresses);
      setHost(session.host);
      setStatus('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start phone pairing');
      setStatus('error');
    }
  }, []);

  // Never leave the LAN server listening because the user navigated away.
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
      void window.novarec.stopPhoneSession().catch(() => undefined);
    };
  }, []);

  return { status, url, code, stream, error, addresses, host, start, stop };
}
