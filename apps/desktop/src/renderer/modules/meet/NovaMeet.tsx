import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { useAppStore } from '../../store.js';
import { useAppSettings } from '../settings/useAppSettings.js';

/**
 * NovaRec meeting: a real LiveKit call. Tokens are minted locally in main from
 * the user's LiveKit credentials; this joins the room, publishes camera + mic,
 * and renders a tile per participant. Needs a LiveKit server (Cloud or
 * self-hosted) configured in Settings → Meetings.
 */
function initials(nameOrId: string): string {
  return (nameOrId.trim()[0] ?? '?').toUpperCase();
}

export function NovaMeet(): ReactElement {
  const settings = useAppSettings();
  const setView = useAppStore((s) => s.setView);
  const configured = Boolean(
    settings.data?.livekitUrl && settings.data?.livekitApiKey && settings.data?.livekitApiSecret,
  );

  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [, forceRender] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(
    () => () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
    },
    [],
  );

  async function join(): Promise<void> {
    const displayName = name.trim();
    const room = roomName.trim();
    if (!displayName || !room) {
      setError('Enter your name and a room name.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const identity = `${displayName}-${crypto.randomUUID().slice(0, 8)}`;
      const { token, url } = await window.novarec.meetToken({
        room,
        identity,
        name: displayName,
        role: 'host',
      });
      if (!url) throw new Error('No LiveKit URL configured.');

      const rtc = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = rtc;
      rtc
        .on(RoomEvent.ParticipantConnected, bump)
        .on(RoomEvent.ParticipantDisconnected, bump)
        .on(RoomEvent.TrackSubscribed, bump)
        .on(RoomEvent.TrackUnsubscribed, bump)
        .on(RoomEvent.TrackMuted, bump)
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.Disconnected, () => {
          setJoined(false);
          roomRef.current = null;
          bump();
        });

      await rtc.connect(url, token);
      await rtc.localParticipant.enableCameraAndMicrophone();
      setMicOn(true);
      setCamOn(true);
      setJoined(true);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the meeting');
      void roomRef.current?.disconnect();
      roomRef.current = null;
    } finally {
      setConnecting(false);
    }
  }

  function leave(): void {
    void roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    bump();
  }

  async function toggleMic(): Promise<void> {
    const rtc = roomRef.current;
    if (!rtc) return;
    const next = !micOn;
    await rtc.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
    bump();
  }

  async function toggleCam(): Promise<void> {
    const rtc = roomRef.current;
    if (!rtc) return;
    const next = !camOn;
    await rtc.localParticipant.setCameraEnabled(next);
    setCamOn(next);
    bump();
  }

  if (!joined) {
    return (
      <div className="max-w-md space-y-4">
        {!configured && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-app bg-surface px-4 py-3">
            <p className="min-w-0 text-sm text-muted-app">
              Add your LiveKit server in Settings to host meetings.
            </p>
            <button
              type="button"
              onClick={() => setView('settings')}
              className="shrink-0 rounded-lg bg-surface2 px-3 py-2 text-sm font-medium text-app2 transition hover:text-app"
            >
              Set up
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-app bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-app">
            Start or join a room
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-app">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane"
                className="w-full rounded-lg bg-surface2 px-3 py-2.5 text-sm text-app placeholder:text-dim-app"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-app">Room</span>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void join();
                }}
                placeholder="team-standup"
                className="w-full rounded-lg bg-surface2 px-3 py-2.5 text-sm text-app placeholder:text-dim-app"
              />
            </label>
            <button
              type="button"
              onClick={() => void join()}
              disabled={connecting || !configured}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
            >
              {connecting ? 'Joining…' : 'Join meeting'}
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <p className="text-xs text-muted-app">
              Anyone who joins the same room name meets here. Share the room name to invite them.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rtc = roomRef.current;
  const participants: Participant[] = rtc
    ? [rtc.localParticipant, ...rtc.remoteParticipants.values()]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-app2">
          Room <span className="font-medium text-app">{roomName}</span> · {participants.length}{' '}
          {participants.length === 1 ? 'person' : 'people'}
        </p>
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {participants.map((p) => (
          <ParticipantTile key={p.sid} participant={p} isLocal={p === rtc?.localParticipant} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <ControlButton active={micOn} onClick={() => void toggleMic()}>
          {micOn ? '🎤 Mute' : '🔇 Unmute'}
        </ControlButton>
        <ControlButton active={camOn} onClick={() => void toggleCam()}>
          {camOn ? '📷 Stop video' : '🚫 Start video'}
        </ControlButton>
        <button
          type="button"
          onClick={leave}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  children,
  active,
  onClick,
}: {
  children: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-surface2 text-app2 hover:text-app'
          : 'bg-amber-600/80 text-white hover:bg-amber-600'
      }`}
    >
      {children}
    </button>
  );
}

function ParticipantTile({
  participant,
  isLocal,
}: {
  participant: Participant;
  isLocal: boolean;
}): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const camOff = !camPub?.track || camPub.isMuted;

  useEffect(() => {
    const videoEl = videoRef.current;
    if (camPub?.track && videoEl) camPub.track.attach(videoEl);
    return () => {
      if (camPub?.track && videoEl) camPub.track.detach(videoEl);
    };
  }, [camPub, camPub?.track]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!isLocal && micPub?.track && audioEl) micPub.track.attach(audioEl);
    return () => {
      if (!isLocal && micPub?.track && audioEl) micPub.track.detach(audioEl);
    };
  }, [micPub, micPub?.track, isLocal]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-app bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="h-full w-full object-cover"
        style={isLocal ? { transform: 'scaleX(-1)' } : undefined}
      />
      {!isLocal && <audio ref={audioRef} autoPlay />}
      {camOff && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-2xl font-semibold text-white">
            {initials(participant.name || participant.identity)}
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {participant.name || participant.identity}
        {isLocal ? ' (you)' : ''}
      </div>
    </div>
  );
}
