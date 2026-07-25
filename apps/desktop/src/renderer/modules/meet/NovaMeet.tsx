import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Room, RoomEvent, Track, type Participant, type RemoteParticipant } from 'livekit-client';
import {
  EXPORT_PRESETS,
  allConsented,
  pendingConsent,
  recordConsent,
  type ConsentLedger,
  type TrackConfig,
} from '@novarec/shared';
import { useAppStore } from '../../store.js';
import { useAppSettings } from '../settings/useAppSettings.js';
import { useRecorder } from '../record/useRecorder.js';
import { useExportStore } from '../../exportStore.js';
import { MeetingRecorder } from './meetingRecorder.js';

const SCENE_PRESET = EXPORT_PRESETS[0]!; // 1080p MP4

/**
 * NovaRec meeting: a real LiveKit call. Tokens are minted locally in main from
 * the user's LiveKit credentials; this joins the room, publishes camera + mic,
 * and renders a tile per participant. Recording is gated on affirmative consent
 * from every participant (over the LiveKit data channel) and shows an always-on
 * indicator to everyone. Needs a LiveKit server configured in Settings → Meetings.
 */
type MeetMsg =
  | { t: 'consent-request'; name: string }
  | { t: 'consent-response'; consented: boolean }
  | { t: 'rec'; on: boolean };

function sendMsg(room: Room, msg: MeetMsg): void {
  void room.localParticipant
    .publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true })
    .catch(() => undefined);
}

const MEETING_TRACK: TrackConfig = {
  id: 'screen',
  kind: 'screen',
  label: 'Meeting',
  enabled: true,
  gain: 1,
  monitor: false,
};

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
  const [recording, setRecording] = useState(false);
  const [remoteRecording, setRemoteRecording] = useState(false);
  const [awaitingConsent, setAwaitingConsent] = useState<string[] | null>(null);
  const [consentBanner, setConsentBanner] = useState<{ name: string } | null>(null);
  const [, forceRender] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const recorder = useRecorder();
  const exportJob = useExportStore();
  const meetingRecRef = useRef<MeetingRecorder | null>(null);
  const ledgerRef = useRef<ConsentLedger>({});
  const consentTimer = useRef<number | null>(null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(
    () => () => {
      meetingRecRef.current?.stop();
      meetingRecRef.current = null;
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
        .on(RoomEvent.ParticipantConnected, () => {
          // Someone joined mid-recording: tell them so the "Recording" indicator
          // shows for them too (transparency is non-negotiable).
          if (recordingRef.current && roomRef.current) {
            sendMsg(roomRef.current, { t: 'rec', on: true });
          }
          bump();
        })
        .on(RoomEvent.ParticipantDisconnected, bump)
        .on(RoomEvent.TrackSubscribed, bump)
        .on(RoomEvent.TrackUnsubscribed, bump)
        .on(RoomEvent.TrackMuted, bump)
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.DataReceived, (payload, participant) =>
          dataHandler.current(payload, participant),
        )
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
    if (recording) stopRecording();
    else meetingRecRef.current?.stop();
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

  // --- Recording, gated on consent from every participant ---
  const beginRecording = async (): Promise<void> => {
    const rtc = roomRef.current;
    if (!rtc || recording) return;
    try {
      const mr = new MeetingRecorder(rtc);
      mr.start();
      meetingRecRef.current = mr;
      await recorder.start([MEETING_TRACK], 30, { screen: mr.stream(30) });
      setRecording(true);
      sendMsg(rtc, { t: 'rec', on: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording');
      meetingRecRef.current?.stop();
      meetingRecRef.current = null;
    }
  };

  function stopRecording(): void {
    const rtc = roomRef.current;
    if (rtc) sendMsg(rtc, { t: 'rec', on: false });
    void recorder.stop();
    meetingRecRef.current?.stop();
    meetingRecRef.current = null;
    setRecording(false);
  }

  function requestRecord(): void {
    const rtc = roomRef.current;
    if (!rtc) return;
    const remotes = [...rtc.remoteParticipants.values()];
    if (remotes.length === 0) {
      void beginRecording(); // solo — no one else to consent
      return;
    }
    ledgerRef.current = {};
    setError(null);
    setAwaitingConsent(remotes.map((p) => p.identity));
    sendMsg(rtc, { t: 'consent-request', name: name || 'The host' });
    if (consentTimer.current) window.clearTimeout(consentTimer.current);
    consentTimer.current = window.setTimeout(() => {
      setAwaitingConsent((cur) => {
        if (cur) setError('Not everyone agreed in time — recording cancelled.');
        return null;
      });
    }, 30000);
  }

  function respondConsent(consented: boolean): void {
    const rtc = roomRef.current;
    if (rtc) sendMsg(rtc, { t: 'consent-response', consented });
    setConsentBanner(null);
  }

  const dataHandler = useRef<(payload: Uint8Array, p?: RemoteParticipant) => void>(() => undefined);
  dataHandler.current = (payload, participant) => {
    const rtc = roomRef.current;
    if (!rtc) return;
    let msg: MeetMsg;
    try {
      msg = JSON.parse(new TextDecoder().decode(payload)) as MeetMsg;
    } catch {
      return;
    }
    if (msg.t === 'consent-request') {
      setConsentBanner({ name: msg.name });
    } else if (msg.t === 'consent-response' && participant) {
      if (!msg.consented) {
        if (consentTimer.current) window.clearTimeout(consentTimer.current);
        setAwaitingConsent(null);
        setError(`${participant.name || participant.identity} declined recording.`);
        return;
      }
      ledgerRef.current = recordConsent(ledgerRef.current, participant.identity, true, Date.now());
      const remoteIds = [...rtc.remoteParticipants.values()].map((p) => p.identity);
      if (allConsented(ledgerRef.current, remoteIds)) {
        if (consentTimer.current) window.clearTimeout(consentTimer.current);
        setAwaitingConsent(null);
        void beginRecording();
      } else {
        setAwaitingConsent(pendingConsent(ledgerRef.current, remoteIds));
      }
    } else if (msg.t === 'rec') {
      setRemoteRecording(msg.on);
    }
  };

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

  const isRecording = recording || remoteRecording;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-app2">
          Room <span className="font-medium text-app">{roomName}</span> · {participants.length}{' '}
          {participants.length === 1 ? 'person' : 'people'}
        </p>
        {isRecording && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600/20 px-3 py-1 text-xs font-semibold text-red-400 ring-1 ring-inset ring-red-500/40">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            Recording
          </span>
        )}
      </div>

      {/* Someone asked to record — this participant must consent. */}
      {consentBanner && !recording && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-600/15 px-4 py-3">
          <p className="text-sm text-app2">
            <span className="font-medium text-app">{consentBanner.name}</span> wants to record this
            meeting. Is that okay?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respondConsent(false)}
              className="rounded-lg bg-surface2 px-3 py-2 text-sm font-medium text-app2 transition hover:text-app"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respondConsent(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Allow
            </button>
          </div>
        </div>
      )}

      {/* Host is waiting for everyone to agree. */}
      {awaitingConsent && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-app bg-surface px-4 py-3">
          <p className="text-sm text-muted-app">
            Waiting for consent from {awaitingConsent.length}{' '}
            {awaitingConsent.length === 1 ? 'person' : 'people'}…
          </p>
          <button
            type="button"
            onClick={() => {
              if (consentTimer.current) window.clearTimeout(consentTimer.current);
              setAwaitingConsent(null);
            }}
            className="rounded-lg bg-surface2 px-3 py-1.5 text-xs text-app2 transition hover:text-app"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {participants.map((p) => (
          <ParticipantTile key={p.sid} participant={p} isLocal={p === rtc?.localParticipant} />
        ))}
      </div>

      {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <ControlButton active={micOn} onClick={() => void toggleMic()}>
          {micOn ? '🎤 Mute' : '🔇 Unmute'}
        </ControlButton>
        <ControlButton active={camOn} onClick={() => void toggleCam()}>
          {camOn ? '📷 Stop video' : '🚫 Start video'}
        </ControlButton>
        {recording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
          >
            ⏹ Stop recording
          </button>
        ) : (
          <button
            type="button"
            onClick={requestRecord}
            disabled={awaitingConsent !== null}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted-app"
          >
            ⏺ Record
          </button>
        )}
        {!recording && recorder.lastRecordingDir && (
          <button
            type="button"
            onClick={() =>
              recorder.lastRecordingDir &&
              exportJob.start(recorder.lastRecordingDir, SCENE_PRESET.settings)
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Export recording
          </button>
        )}
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
