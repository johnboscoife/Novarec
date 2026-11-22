import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  EXPORT_PRESETS,
  SUPPORTED_TARGET_FPS,
  countdownSequence,
  type CaptureSource,
  type ControlAction,
  type ExportSettings,
  type HotkeyAction,
  type SavedRegion,
  type TargetFps,
  type TrackConfig,
  type WebcamShape,
} from '@novarec/shared';
import { useAppInfo } from '../shell/useAppInfo.js';
import {
  useCaptureSettings,
  useDisplays,
  useMediaDevices,
  usePrimeDevices,
  useSaveCaptureSettings,
  useSources,
} from './useCaptureData.js';
import { useRecorder } from './useRecorder.js';
import { RecordingControls } from './RecordingControls.js';
import { RecoveryBanner } from './RecoveryBanner.js';
import { DiskSpaceNotice } from './DiskSpaceNotice.js';
import { SourcesErrorNotice } from './SourcesErrorNotice.js';
import { RecordHero, type HeroSummary } from './RecordHero.js';
import { MicMeter } from './MicMeter.js';
import { CameraSelect } from './CameraSelect.js';
import { PHONE_WIFI_DEVICE_ID, isPhoneWifiDevice } from '@novarec/capture';
import {
  DEFAULT_HOTKEYS,
  humanizeAccelerator,
  MKV_COPY_PRESET_ID,
  MP4_COPY_PRESET_ID,
  type RecordingContainer,
  type RecordingMode,
  type RecordingQuality,
} from '@novarec/shared';
import { PhoneCameraPanel } from './PhoneCameraPanel.js';
import { usePhoneCamera } from './usePhoneCamera.js';
import type { RegionSpec } from './cropStream.js';
import { useAppSettings, useSaveAppSettings } from '../settings/useAppSettings.js';
import { useExportStore } from '../../exportStore.js';
import { REGION_CAPTURE_ENABLED } from '../../featureFlags.js';

const DEFAULT_PRESET = EXPORT_PRESETS[0]!;
function presetSettings(id: string): ExportSettings {
  return (EXPORT_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET).settings;
}

/** Capture setup is persisted on a trailing edge — a slider drag is one write. */
const SETTINGS_SAVE_DEBOUNCE_MS = 400;
/** The floating webcam is re-placed over IPC; coalesce drags into one call. */
const WEBCAM_APPLY_DEBOUNCE_MS = 120;

export function RecordView(): ReactElement {
  const displays = useDisplays();
  const sources = useSources();
  const devices = useMediaDevices();
  const settings = useCaptureSettings();
  const save = useSaveCaptureSettings();

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [targetFps, setTargetFps] = useState<TargetFps>(30);
  const [region, setRegion] = useState<SavedRegion | null>(null);

  // Additional tracks captured alongside the screen (kept separate until export).
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [systemAudioOn, setSystemAudioOn] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [webcamShape, setWebcamShape] = useState<WebcamShape>('circle');
  const [webcamSize, setWebcamSize] = useState(240);
  const [cursorZoomEnabled, setCursorZoomEnabled] = useState(true);
  const [cursorZoomScale, setCursorZoomScale] = useState(2);
  const [cursorHighlight, setCursorHighlight] = useState(false);
  const [cursorClickEffects, setCursorClickEffects] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [cursorSmoothing, setCursorSmoothing] = useState(false);
  const [clickTrackingAvailable, setClickTrackingAvailable] = useState(true);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [snapshotPath, setSnapshotPath] = useState<string | null>(null);
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>('high');
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('single');
  const [recordingContainer, setRecordingContainer] = useState<RecordingContainer>('mp4');
  const [webcamStatus, setWebcamStatus] = useState<{ state: string; message: string } | null>(null);
  const [webcamZoom, setWebcamZoom] = useState(1);
  const [webcamMirror, setWebcamMirror] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [rawBytes, setRawBytes] = useState<number | null>(null);
  const [rawDeleted, setRawDeleted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  // Leaving the view mid-countdown must not start a take nobody can see.
  useEffect(
    () => () => {
      if (countdownTimer.current !== null) window.clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    },
    [],
  );
  const [showPhonePanel, setShowPhonePanel] = useState(true);

  // Phone-as-camera over Wi-Fi. Its stream is injected into the recorder as a
  // real 'camera' track, which the export compositor already overlays
  // picture-in-picture — no separate compositing path needed.
  const phone = usePhoneCamera();
  // The phone counts as the camera only when the user has actually selected it
  // in the picker — same rule as any other camera source.
  const usingPhoneCamera = cameraOn && isPhoneWifiDevice(cameraDeviceId) && phone.stream !== null;

  // Export is an app-wide background job (keeps running across view switches).
  const exportJob = useExportStore();
  const recorder = useRecorder();
  const info = useAppInfo();
  // System-audio loopback is a Windows-only capability; offering it elsewhere
  // silently records nothing. Default to Windows (the primary target) until
  // app info resolves so the control doesn't flicker.
  const isWindows = (info.data?.platform ?? 'win32') === 'win32';
  const appSettings = useAppSettings();
  const saveAppSettings = useSaveAppSettings();
  const autoExportedDir = useRef<string | null>(null);
  const exportPresetId = appSettings.data?.exportPreset ?? 'youtube';

  const screens = useMemo(() => sources.data?.screens ?? [], [sources.data]);
  const windows = useMemo(() => sources.data?.windows ?? [], [sources.data]);
  const videoDevices = useMemo(
    () => (devices.data ?? []).filter((d) => d.kind === 'camera'),
    [devices.data],
  );
  const audioDevices = useMemo(
    () => (devices.data ?? []).filter((d) => d.kind === 'microphone'),
    [devices.data],
  );
  const primeDevices = usePrimeDevices();

  // The display behind the chosen screen source — the frame a region is cut from.
  const selectedScreen = useMemo(
    () => screens.find((s) => s.id === selectedSourceId) ?? null,
    [screens, selectedSourceId],
  );
  const capturedDisplay = useMemo(
    () =>
      selectedScreen
        ? (displays.data?.find((d) => d.id === selectedScreen.displayId) ?? null)
        : null,
    [selectedScreen, displays.data],
  );

  // A region only means something for a screen capture: a window source already
  // is its own crop, and its frames aren't in display coordinates.
  const regionApplies = REGION_CAPTURE_ENABLED && region !== null && capturedDisplay !== null;
  // Any effect on means the screen goes through the effects canvas. The frame
  // it maps the pointer into is the REGION when one is cropped, not the display.
  const cursorEffectsActive =
    cursorZoomEnabled || cursorHighlight || cursorClickEffects || cursorHidden || cursorSmoothing;

  const screenRegion = useMemo<RegionSpec | null>(
    () =>
      region && capturedDisplay
        ? { rect: region.rect, displayBounds: capturedDisplay.bounds }
        : null,
    [region, capturedDisplay],
  );

  // Pairing a phone is an unambiguous "use this as my camera", so select it.
  //
  // When it goes away, the camera is switched OFF rather than just deselected.
  // Clearing the id alone left `cameraOn` true, so the next render opened the
  // floating overlay on whatever local webcam happened to be the default — a
  // camera window popping up on its own, every time the phone link dropped.
  // Losing the phone means losing the camera; it does not mean silently
  // substituting a different one.
  const selectedCameraRef = useRef(cameraDeviceId);
  selectedCameraRef.current = cameraDeviceId;
  useEffect(() => {
    if (phone.status === 'live' && phone.stream) {
      setCameraOn(true);
      setCameraDeviceId(PHONE_WIFI_DEVICE_ID);
      return;
    }
    if (phone.stream === null && isPhoneWifiDevice(selectedCameraRef.current)) {
      setCameraOn(false);
      setCameraDeviceId(null);
    }
  }, [phone.status, phone.stream]);

  // Restore the last Record setup (once, when both settings have loaded) if the
  // user opted to retain it; then keep persisting the setup as it changes.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !settings.data || appSettings.data === undefined) return;
    seededRef.current = true;
    const s = settings.data;
    setTargetFps(s.targetFps);
    setRegion(s.region);
    setRecordingMode(s.recordingMode);
    setRecordingContainer(s.recordingContainer);
    setRecordingQuality(s.recordingQuality);
    setCursorZoomEnabled(s.cursorZoomEnabled);
    setCursorZoomScale(s.cursorZoomScale);
    setCursorHighlight(s.cursorHighlight);
    setCursorClickEffects(s.cursorClickEffects);
    setCursorHidden(s.cursorHidden);
    setCursorSmoothing(s.cursorSmoothing);
    if (appSettings.data.retainSetup) {
      setSelectedSourceId(s.sourceId);
      setCameraOn(s.cameraOn);
      setMicOn(s.micOn);
      setSystemAudioOn(s.systemAudioOn);
      // A Wi-Fi phone is never already paired at launch; restoring its id would
      // leave the picker showing a device that does not exist.
      setCameraDeviceId(isPhoneWifiDevice(s.cameraDeviceId) ? null : s.cameraDeviceId);
      setMicDeviceId(s.micDeviceId);
      setWebcamShape(s.webcamShape);
      setWebcamSize(s.webcamSize);
      setWebcamZoom(s.webcamZoom);
      setWebcamMirror(s.webcamMirror);
    }
  }, [settings.data, appSettings.data]);

  // Persist the setup on a trailing edge. Without the debounce every slider tick
  // was a disk write (the store writes atomically via temp+rename).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!seededRef.current) return undefined;
    const timer = window.setTimeout(() => {
      saveRef.current.mutate({
        targetFps,
        resolution: null,
        region,
        recordingMode,
        recordingContainer,
        recordingQuality,
        cursorZoomEnabled,
        cursorZoomScale,
        cursorHighlight,
        cursorClickEffects,
        cursorHidden,
        cursorSmoothing,
        sourceId: selectedSourceId,
        cameraOn,
        micOn,
        systemAudioOn,
        cameraDeviceId,
        micDeviceId,
        webcamShape,
        webcamSize,
        webcamZoom,
        webcamMirror,
      });
    }, SETTINGS_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    targetFps,
    region,
    recordingMode,
    recordingContainer,
    recordingQuality,
    cursorZoomEnabled,
    cursorZoomScale,
    cursorHighlight,
    cursorClickEffects,
    cursorHidden,
    cursorSmoothing,
    selectedSourceId,
    cameraOn,
    micOn,
    systemAudioOn,
    cameraDeviceId,
    micDeviceId,
    webcamShape,
    webcamSize,
    webcamZoom,
    webcamMirror,
  ]);

  // Enabling a track unlocks real device names (Blue Yeti vs. "Microphone").
  const toggleCamera = useCallback(
    (on: boolean): void => {
      setCameraOn(on);
      if (on) void primeDevices({ video: true });
    },
    [primeDevices],
  );
  const toggleMic = useCallback(
    (on: boolean): void => {
      setMicOn(on);
      if (on) void primeDevices({ audio: true });
    },
    [primeDevices],
  );

  const selectRegion = useCallback(async (): Promise<void> => {
    const picked = await window.novarec.beginRegionSelect();
    if (!picked) return;
    setRegion(picked);
    // Point the capture at the display the area was drawn on, so the crop and
    // the captured frames can't disagree.
    if (picked.displayId !== null) {
      const owner = screens.find((s) => s.displayId === picked.displayId);
      if (owner) setSelectedSourceId(owner.id);
    }
  }, [screens]);

  const clearRegion = useCallback((): void => setRegion(null), []);

  function buildTrackConfigs(): TrackConfig[] {
    const configs: TrackConfig[] = [];
    if (selectedSourceId) {
      configs.push({
        id: 'screen',
        kind: 'screen',
        label: 'Screen',
        sourceId: selectedSourceId,
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    // The local camera is NOT a separate recorded track: it's the floating
    // overlay window, captured into the screen recording in place.
    //
    // A PHONE camera is different — it arrives as a WebRTC stream with no window
    // on screen to capture, so it is recorded as its own track and composited at
    // export time. The id must be 'camera' for the export to give it the
    // picture-in-picture role.
    if (usingPhoneCamera && phone.stream) {
      configs.push({
        id: 'camera',
        kind: 'camera',
        label: 'Phone camera',
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    if (micOn) {
      configs.push({
        id: 'microphone',
        kind: 'microphone',
        label: 'Microphone',
        enabled: true,
        gain: 1,
        monitor: false,
        ...(micDeviceId ? { deviceId: micDeviceId } : {}),
      });
    }
    if (systemAudioOn && isWindows) {
      configs.push({
        id: 'systemAudio',
        kind: 'systemAudio',
        label: 'System audio',
        enabled: true,
        gain: 1,
        monitor: false,
      });
    }
    return configs;
  }

  // The floating camera is baked into the screen recording, so it isn't a
  // standalone track — recording needs a screen/window or an audio source.
  const canRecord = selectedSourceId !== null || micOn || (systemAudioOn && isWindows);

  function beginRecording(): void {
    if (!canRecord || recorder.state !== 'idle' || countdown !== null) return;
    const sequence = countdownSequence(3);
    const configs = buildTrackConfigs();
    // Only pass the region when it can actually be applied; a window capture
    // must never be started with a crop it would ignore.
    if (cursorEffectsActive) {
      void window.novarec
        .startCursorTracking()
        .then((r) => setClickTrackingAvailable(r.clickTracking))
        .catch(() => undefined);
    }
    const effectsBounds = regionApplies && region ? region.rect : (capturedDisplay?.bounds ?? null);
    const options = {
      screenRegion: regionApplies ? screenRegion : null,
      singleFile: recordingMode === 'single',
      quality: recordingQuality,
      cursorEffects:
        cursorEffectsActive && effectsBounds
          ? {
              displayBounds: effectsBounds,
              fps: targetFps,
              zoomScale: cursorZoomScale,
              highlight: cursorHighlight,
              clickEffects: cursorClickEffects,
              drawCursor: cursorHidden,
              smoothing: cursorSmoothing,
            }
          : null,
    };
    // The phone stream is already acquired; hand it to the recorder rather than
    // letting it try to open a device that does not exist locally.
    const provided = usingPhoneCamera && phone.stream ? { camera: phone.stream } : undefined;
    const startNow = (): void => {
      void recorder.start(configs, targetFps, provided, options).then((started) => {
        // Tracking began above, before the take; a take that never started
        // must not leave the global pointer hook running.
        if (!started) void window.novarec.stopCursorTracking().catch(() => undefined);
      });
    };
    if (sequence.length === 0) {
      startNow();
      return;
    }
    let index = 0;
    setCountdown(sequence[0] ?? null);
    countdownTimer.current = window.setInterval(() => {
      index += 1;
      if (index >= sequence.length) {
        clearCountdownTimer();
        setCountdown(null);
        startNow();
      } else {
        setCountdown(sequence[index] ?? null);
      }
    }, 1000);
  }

  function clearCountdownTimer(): void {
    if (countdownTimer.current !== null) window.clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  }

  /**
   * Abandon a countdown before it starts a take. During the countdown the
   * recorder is still idle, so without this a stop request (hotkey, floating
   * controller) would do nothing and the take would start anyway.
   */
  function cancelCountdown(): boolean {
    if (countdownTimer.current === null) return false;
    clearCountdownTimer();
    setCountdown(null);
    void window.novarec.stopCursorTracking().catch(() => undefined);
    return true;
  }

  /** Stop whatever is in progress: a countdown, or the take itself. */
  function stopRecording(): void {
    if (!cancelCountdown()) void recorder.stop();
  }

  function exportLastRecording(): void {
    if (recorder.lastRecordingDir) {
      exportJob.start(recorder.lastRecordingDir, presetSettings(exportPresetId));
    }
  }

  // View-scoped mirror of the app-wide export job for the "Last recording" card.
  const jobForThis = exportJob.dir === recorder.lastRecordingDir ? exportJob : null;
  const exporting = jobForThis?.status === 'running';
  const exportProgress = exporting ? jobForThis.progress : null;
  const exportedPath = jobForThis?.status === 'done' ? jobForThis.outputPath : null;
  const exportError = jobForThis?.status === 'error' ? jobForThis.error : null;

  // Auto-export when a recording stops, if enabled in Settings. A ref holds the
  // latest closure so the effect can depend only on the stop transition, and
  // `autoExportedDir` guards against exporting the same recording twice.
  const maybeAutoExport = useRef<(dir: string) => void>(() => undefined);
  maybeAutoExport.current = (dir) => {
    if (autoExportedDir.current === dir) return;
    // A single-file take is already muxed on disk; finishing it is a re-wrap
    // into the chosen container at disk speed, not an encode. It always runs —
    // there is no version of "recorded straight to MP4" that waits for a click.
    if (recordingMode === 'single') {
      autoExportedDir.current = dir;
      exportJob.start(
        dir,
        presetSettings(recordingContainer === 'mkv' ? MKV_COPY_PRESET_ID : MP4_COPY_PRESET_ID),
      );
      return;
    }
    // Separate-track takes still need a real export, and only if asked for.
    if (appSettings.data?.autoExportOnStop) {
      autoExportedDir.current = dir;
      exportJob.start(dir, presetSettings(exportPresetId));
    }
  };
  useEffect(() => {
    if (recorder.state === 'idle' && recorder.lastRecordingDir) {
      maybeAutoExport.current(recorder.lastRecordingDir);
    }
  }, [recorder.state, recorder.lastRecordingDir]);

  // Reset the "delete original" affordance whenever a new recording appears.
  useEffect(() => {
    setRawDeleted(false);
    setRawBytes(null);
  }, [recorder.lastRecordingDir]);

  // Once an export finishes, measure the raw recording so we can offer to free it.
  useEffect(() => {
    const dir = recorder.lastRecordingDir;
    if (jobForThis?.status === 'done' && dir && !rawDeleted && rawBytes === null) {
      void window.novarec.recordingSize({ dir }).then(({ bytes }) => setRawBytes(bytes));
    }
  }, [jobForThis?.status, recorder.lastRecordingDir, rawDeleted, rawBytes]);

  async function deleteRaw(): Promise<void> {
    const dir = recorder.lastRecordingDir;
    if (!dir) return;
    await window.novarec.deleteRawRecording({ dir }).catch(() => undefined);
    setRawDeleted(true);
    setRawBytes(null);
  }

  // The floating webcam is a separate always-on-top window captured into the
  // recording — so it appears in the export exactly where/size/shape it sits.
  // Place it on the display being captured; a webcam on another monitor wouldn't
  // be in the recording at all. Debounced so dragging the size slider is one IPC
  // call, not one per pixel.
  useEffect(() => {
    // The floating overlay window captures a LOCAL device by id; a Wi-Fi phone
    // has no such device, and its stream lives in this window. When the phone is
    // the camera there is no overlay — it is recorded as its own track instead.
    if (!cameraOn || isPhoneWifiDevice(cameraDeviceId)) {
      void window.novarec.hideWebcam();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void window.novarec.showWebcam({
        deviceId: cameraDeviceId,
        label: videoDevices.find((d) => (d.deviceId ?? d.id) === cameraDeviceId)?.label ?? '',
        shape: webcamShape,
        sizePx: webcamSize,
        zoom: webcamZoom,
        mirror: webcamMirror,
        displayBounds: capturedDisplay ? capturedDisplay.bounds : null,
      });
    }, WEBCAM_APPLY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    cameraOn,
    cameraDeviceId,
    videoDevices,
    webcamShape,
    webcamSize,
    webcamZoom,
    webcamMirror,
    capturedDisplay,
  ]);

  // The floating camera window reports whether it actually opened. Surfacing it
  // HERE matters: that window is small and often hidden behind others, and this
  // is where the camera was chosen.
  useEffect(() => window.novarec.onWebcamStatus((status) => setWebcamStatus(status)), []);
  useEffect(() => {
    if (!cameraOn) setWebcamStatus(null);
  }, [cameraOn]);

  // Track the pointer only while a recording is live — it is a 60Hz sample and
  // a global hook, neither of which should run when nothing is being recorded.
  // Tracking is started explicitly in `beginRecording`, BEFORE the capture
  // pipeline is built: the effects stream reads the pointer as soon as it is
  // created, and starting tracking afterwards left the first frames zoomed at
  // the top-left corner instead of at the cursor. This only handles stopping.
  useEffect(() => {
    if (recorder.state !== 'idle') return undefined;
    void window.novarec.stopCursorTracking().catch(() => undefined);
    return undefined;
  }, [recorder.state]);

  useEffect(() => {
    if (recorder.state === 'idle') setZoomedIn(false);
  }, [recorder.state]);

  // Always tear the overlay down when leaving Record.
  useEffect(() => () => void window.novarec.hideWebcam(), []);

  // Floating recording control: show it while recording, publish state to it,
  // and act on the commands it sends back.
  useEffect(() => {
    if (recorder.state === 'idle') {
      void window.novarec.hideControls();
      if (micMuted) setMicMuted(false);
    } else {
      void window.novarec.showControls();
    }
  }, [recorder.state, micMuted]);

  useEffect(() => {
    void window.novarec.publishRecordState({
      state: recorder.state,
      elapsedMs: recorder.elapsedMs,
      micMuted,
      micAvailable: micOn,
      webcamOn: cameraOn,
      zoomed: zoomedIn,
      zoomAvailable: cursorZoomEnabled && cursorEffectsActive,
    });
  }, [
    recorder.state,
    recorder.elapsedMs,
    micMuted,
    micOn,
    cameraOn,
    zoomedIn,
    cursorZoomEnabled,
    cursorEffectsActive,
  ]);

  const controlHandler = useRef<(action: ControlAction) => void>(() => undefined);
  controlHandler.current = (action) => {
    if (action === 'pause') void recorder.pause();
    else if (action === 'resume') void recorder.resume();
    else if (action === 'stop') stopRecording();
    else if (action === 'muteMic') {
      const next = !micMuted;
      setMicMuted(next);
      recorder.setMicMuted(next);
    } else if (action === 'toggleWebcam') {
      setCameraOn((on) => !on);
    } else if (action === 'toggleZoom') {
      toggleZoom();
    } else if (action === 'snapshot') {
      void recorder
        .snapshot()
        .then((path) => setSnapshotPath(path))
        .catch(() => undefined);
    }
  };
  useEffect(() => window.novarec.onControlsAction((action) => controlHandler.current(action)), []);

  // Global hotkeys drive the recording lifecycle even when the app is unfocused.
  const hotkeyHandler = useRef<(action: HotkeyAction) => void>(() => undefined);
  hotkeyHandler.current = (action) => {
    if (action === 'startStop') {
      if (recorder.state === 'idle' && countdown === null) beginRecording();
      else stopRecording();
    } else if (action === 'pauseResume') {
      if (recorder.state === 'recording') void recorder.pause();
      else if (recorder.state === 'paused') void recorder.resume();
    } else if (action === 'muteMic') {
      // Same path the floating control bar uses, so the two can't disagree.
      const next = !micMuted;
      setMicMuted(next);
      recorder.setMicMuted(next);
    } else if (action === 'marker') {
      if (recorder.state !== 'idle') recorder.addMarker();
    } else if (action === 'cursorZoomNow') {
      toggleZoom();
    } else if (action === 'panicStop') {
      stopRecording();
    }
  };
  useEffect(() => window.novarec.onHotkey((action) => hotkeyHandler.current(action)), []);

  // One place flips the zoom, so the shortcut and the floating button can never
  // disagree about whether it is on.
  const toggleZoomRef = useRef<() => void>(() => undefined);
  toggleZoomRef.current = () => {
    if (recorder.state === 'idle' || !cursorZoomEnabled || !cursorEffectsActive) return;
    setZoomedIn((on) => {
      recorder.setZoomed(!on);
      return !on;
    });
  };
  const toggleZoom = (): void => toggleZoomRef.current();

  const zoomShortcut = humanizeAccelerator(
    DEFAULT_HOTKEYS.find((h) => h.action === 'cursorZoomNow')?.accelerator ?? '',
    info.data?.platform ?? 'win32',
  );

  const heroSummary = useMemo<HeroSummary>(() => {
    const extras: string[] = [];
    if (cameraOn) extras.push('Camera');
    if (micOn) extras.push('Microphone');
    if (systemAudioOn && isWindows) extras.push('System audio');
    if (usingPhoneCamera) extras.push('Phone camera');
    const sourceLabel = selectedSourceId
      ? (selectedScreen?.name ??
        windows.find((w) => w.id === selectedSourceId)?.name ??
        'Selected source')
      : null;
    return {
      sourceLabel,
      regionLabel: regionApplies
        ? `Area ${Math.round(region!.rect.width)}×${Math.round(region!.rect.height)}`
        : null,
      extras,
      fps: targetFps,
    };
  }, [
    cameraOn,
    micOn,
    systemAudioOn,
    isWindows,
    usingPhoneCamera,
    selectedSourceId,
    selectedScreen,
    windows,
    regionApplies,
    region,
    targetFps,
  ]);

  return (
    <section className="relative flex h-full flex-col overflow-auto p-8">
      {countdown !== null && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70">
          <span className="text-8xl font-semibold tabular-nums text-white">{countdown}</span>
        </div>
      )}

      <header className="mb-5">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-app">Record</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set up your capture</h1>
      </header>

      <RecoveryBanner />
      <SourcesErrorNotice error={sources.error} onRetry={() => void sources.refetch()} />
      <DiskSpaceNotice />

      <div className="mt-4">
        <RecordingControls
          recorder={recorder}
          canStart={canRecord && recorder.state === 'idle' && countdown === null}
          onStart={beginRecording}
          zoomed={zoomedIn}
          zoomShortcut={zoomShortcut}
        />
      </div>

      {snapshotPath && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-app bg-surface p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Snapshot saved</p>
            <p className="truncate text-xs text-muted-app">{snapshotPath}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void window.novarec.revealPath({ path: snapshotPath })}
              className="rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 transition hover:text-app"
            >
              Show in folder
            </button>
            <button
              type="button"
              onClick={() => setSnapshotPath(null)}
              className="rounded-lg bg-surface2 px-3 py-2 text-sm text-muted-app transition hover:text-app2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {recorder.state === 'idle' && recorder.lastRecordingDir && (
        <div className="mt-4 rounded-2xl border border-app bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {recordingMode === 'single'
                  ? exporting
                    ? 'Finishing your recording…'
                    : 'Recording saved'
                  : 'Last recording ready'}
              </p>
              <p className="truncate text-xs text-muted-app">
                {exportedPath ?? recorder.lastRecordingDir}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={exportPresetId}
                disabled={exporting}
                onChange={(e) =>
                  appSettings.data &&
                  saveAppSettings.mutate({ ...appSettings.data, exportPreset: e.target.value })
                }
                aria-label="Export format"
                className="rounded-lg bg-surface2 px-3 py-2 text-sm text-app2 disabled:opacity-60"
              >
                {EXPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportLastRecording()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-blue-500 disabled:opacity-60"
              >
                {exporting
                  ? recordingMode === 'single'
                    ? 'Finishing…'
                    : 'Exporting…'
                  : exportedPath
                    ? 'Export again'
                    : 'Export'}
              </button>
            </div>
          </div>
          {exporting && exportProgress !== null && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full bg-blue-500 transition-[width]"
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
          )}
          {exportError && <p className="mt-2 text-sm text-red-400">{exportError}</p>}
          {exportedPath && rawBytes !== null && rawBytes > 0 && !rawDeleted && (
            <button
              type="button"
              onClick={() => void deleteRaw()}
              className="mt-3 rounded-lg bg-surface2 px-3 py-1.5 text-xs text-app2 transition hover:text-app"
            >
              Delete original recording · free {(rawBytes / (1024 * 1024)).toFixed(0)} MB
            </button>
          )}
          {rawDeleted && (
            <p className="mt-2 text-xs text-muted-app">
              Original recording deleted to free space ✓
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Capture setup — one compact card */}
        <div className="rounded-2xl border border-app bg-surface p-5">
          <SectionLabel>What to capture</SectionLabel>
          <select
            value={selectedSourceId ?? ''}
            onChange={(e) => setSelectedSourceId(e.target.value || null)}
            className="w-full rounded-lg bg-surface2 px-3 py-2.5 text-sm text-app"
          >
            <option value="">Select a screen or window…</option>
            {screens.length > 0 && (
              <optgroup label="Screens">
                {screens.map((s) => {
                  const d = displays.data?.find((x) => x.id === s.displayId);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {d
                        ? ` — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' · primary' : ''}`
                        : ''}
                    </option>
                  );
                })}
              </optgroup>
            )}
            {windows.length > 0 && (
              <optgroup label="Windows">
                {windows.slice(0, 60).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name || 'Untitled window'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {REGION_CAPTURE_ENABLED && (
            <>
              <SectionLabel className="mt-5">Area</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <AreaOption
                  active={region === null}
                  title="Full screen"
                  detail={
                    capturedDisplay
                      ? `${capturedDisplay.bounds.width}×${capturedDisplay.bounds.height}`
                      : 'Everything on the selected source'
                  }
                  onClick={clearRegion}
                />
                <AreaOption
                  active={region !== null}
                  title="Selected area"
                  detail={
                    region
                      ? `${Math.round(region.rect.width)}×${Math.round(region.rect.height)} at (${Math.round(region.rect.x)}, ${Math.round(region.rect.y)})`
                      : 'Drag a rectangle to record'
                  }
                  onClick={() => void selectRegion()}
                />
              </div>
              {region !== null && (
                <p className="mt-2 text-xs text-muted-app">
                  {capturedDisplay ? (
                    <>
                      Only this area is recorded and exported ·{' '}
                      <button
                        type="button"
                        onClick={() => void selectRegion()}
                        className="text-blue-400 hover:underline"
                      >
                        re-select
                      </button>
                    </>
                  ) : (
                    <span className="text-amber-400">
                      An area applies to a screen capture. Choose a screen above, or clear the area
                      — the window will be recorded in full.
                    </span>
                  )}
                </p>
              )}
            </>
          )}

          <SectionLabel className="mt-5">Also include</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <TrackChip label="Camera" active={cameraOn} onClick={toggleCamera} />
            <TrackChip label="Microphone" active={micOn} onClick={toggleMic} />
            {isWindows && (
              <TrackChip
                label="System audio"
                hint="Windows"
                active={systemAudioOn}
                onClick={setSystemAudioOn}
              />
            )}
          </div>
          {(cameraOn || micOn) && (
            <div className="mt-3 space-y-2">
              {cameraOn && (
                <>
                  <CameraSelect
                    cameras={videoDevices}
                    value={cameraDeviceId}
                    onChange={setCameraDeviceId}
                    wifiPhoneConnected={phone.stream !== null}
                  />
                  {webcamStatus && webcamStatus.state !== 'live' && webcamStatus.message && (
                    <p
                      className={`pl-[88px] text-xs leading-relaxed ${
                        webcamStatus.state === 'error' ? 'text-amber-400' : 'text-muted-app'
                      }`}
                    >
                      {webcamStatus.message}
                    </p>
                  )}
                </>
              )}
              {micOn && (
                <>
                  <DeviceSelect
                    label="Microphone"
                    devices={audioDevices}
                    value={micDeviceId}
                    onChange={setMicDeviceId}
                  />
                  {/* Confirms the chosen input is actually hearing something
                      BEFORE a take is lost to a muted or wrong device. */}
                  <MicMeter deviceId={micDeviceId} enabled={micOn} muted={micMuted} />
                </>
              )}
            </div>
          )}

          <SectionLabel className="mt-5">Frame rate</SectionLabel>
          <div className="flex gap-2">
            {SUPPORTED_TARGET_FPS.map((fps) => (
              <button
                key={fps}
                type="button"
                onClick={() => setTargetFps(fps)}
                aria-pressed={targetFps === fps}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  targetFps === fps
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface2 text-app2 hover:bg-surface2'
                }`}
              >
                {fps}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-app">
            Not sure what this machine can hold? Run the capacity check in{' '}
            <span className="text-app2">Settings → Performance</span>.
          </p>

          <SectionLabel className="mt-5">Quality</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <FormatOption
              active={recordingQuality === 'balanced'}
              title="Balanced"
              detail="Smaller files"
              onClick={() => setRecordingQuality('balanced')}
            />
            <FormatOption
              active={recordingQuality === 'high'}
              title="High"
              detail="Recommended"
              onClick={() => setRecordingQuality('high')}
            />
            <FormatOption
              active={recordingQuality === 'best'}
              title="Best"
              detail="Largest files"
              onClick={() => setRecordingQuality('best')}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-app">
            Costs disk space, not processing — the recorder simply gets more bits to keep text
            sharp. Higher settings make no difference to how hard your machine works.
          </p>

          <SectionLabel className="mt-5">Cursor &amp; zoom</SectionLabel>
          <div className="space-y-2.5">
            <CursorToggle
              label="Zoom to cursor"
              hint={`Press ${zoomShortcut} while recording to zoom toward the pointer, again to zoom out.`}
              checked={cursorZoomEnabled}
              onChange={setCursorZoomEnabled}
            />
            {cursorZoomEnabled && (
              <label className="block pl-1">
                <span className="mb-1 flex items-center justify-between text-xs text-muted-app">
                  <span>Zoom amount</span>
                  <span>{cursorZoomScale.toFixed(1)}×</span>
                </span>
                <input
                  type="range"
                  min={1.2}
                  max={4}
                  step={0.1}
                  value={cursorZoomScale}
                  onChange={(e) => setCursorZoomScale(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </label>
            )}
            <CursorToggle
              label="Highlight the cursor"
              hint="A soft ring follows the pointer so viewers can track it."
              checked={cursorHighlight}
              onChange={setCursorHighlight}
            />
            <CursorToggle
              label="Click effects"
              hint={
                clickTrackingAvailable
                  ? 'A ripple marks each click.'
                  : 'Unavailable on this machine — the global mouse hook did not load.'
              }
              checked={cursorClickEffects && clickTrackingAvailable}
              disabled={!clickTrackingAvailable}
              onChange={setCursorClickEffects}
            />
            <CursorToggle
              label="Hide the real cursor"
              hint="Leaves the system pointer out of the capture and draws a clean one instead."
              checked={cursorHidden}
              onChange={setCursorHidden}
            />
            <CursorToggle
              label="Smooth cursor motion"
              hint={
                cursorHidden
                  ? 'Eases the pointer so quick movement looks deliberate.'
                  : 'Needs “Hide the real cursor” — a pointer burned into the captured pixels cannot be eased.'
              }
              checked={cursorSmoothing && cursorHidden}
              disabled={!cursorHidden}
              onChange={setCursorSmoothing}
            />
          </div>

          <SectionLabel className="mt-5">Save as</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <FormatOption
              active={recordingMode === 'single' && recordingContainer === 'mp4'}
              title="MP4"
              detail="Plays everywhere"
              onClick={() => {
                setRecordingMode('single');
                setRecordingContainer('mp4');
              }}
            />
            <FormatOption
              active={recordingMode === 'single' && recordingContainer === 'mkv'}
              title="MKV"
              detail="Ready fastest"
              onClick={() => {
                setRecordingMode('single');
                setRecordingContainer('mkv');
              }}
            />
            <FormatOption
              active={recordingMode === 'tracks'}
              title="Separate tracks"
              detail="Mix audio later"
              onClick={() => setRecordingMode('tracks')}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-app">
            {recordingMode === 'tracks'
              ? 'Every source is kept in its own file, so you can re-balance the audio afterwards — but the take needs exporting before it is watchable.'
              : recordingContainer === 'mkv'
                ? 'Recorded as one file, ready the moment you stop — nothing is re-encoded at all.'
                : 'Recorded as one file, ready seconds after you stop. The video is never re-encoded; only the audio is converted, so the file opens in any player or editor.'}
          </p>
        </div>

        {/* Floating camera + the capture banner */}
        <div className="space-y-4">
          {cameraOn && (
            <div className="rounded-2xl border border-app bg-surface p-5">
              <SectionLabel>Floating camera</SectionLabel>
              <p className="text-xs leading-relaxed text-muted-app">
                A live webcam window floats on your screen — drag it anywhere; it&apos;s recorded in
                place. Shape and size apply live, even while recording.
              </p>

              <div className="mt-3 flex gap-2">
                {(['circle', 'rounded', 'square'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => setWebcamShape(shape)}
                    aria-pressed={webcamShape === shape}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${
                      webcamShape === shape
                        ? 'bg-blue-600 text-white'
                        : 'bg-surface2 text-app2 hover:bg-surface2'
                    }`}
                  >
                    {shape}
                  </button>
                ))}
              </div>

              <label className="mt-4 block">
                <span className="mb-1 flex items-center justify-between text-xs text-muted-app">
                  <span>Size</span>
                  <span>{webcamSize}px</span>
                </span>
                <input
                  type="range"
                  min={140}
                  max={520}
                  step={10}
                  value={webcamSize}
                  onChange={(e) => setWebcamSize(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </label>

              <label className="mt-3 block">
                <span className="mb-1 flex items-center justify-between text-xs text-muted-app">
                  <span>Zoom</span>
                  <span>{webcamZoom.toFixed(1)}×</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.1}
                  value={webcamZoom}
                  onChange={(e) => setWebcamZoom(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <span className="mt-1 block text-xs leading-relaxed text-dim-app">
                  Crops in from the centre. Use it when a camera adds its own black bars — phone
                  cameras often send a portrait picture inside a landscape frame.
                </span>
              </label>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-app">Mirror</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={webcamMirror}
                  onClick={() => setWebcamMirror((v) => !v)}
                  title="Off for a rear camera, or when text on screen should read the right way round"
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    webcamMirror ? 'bg-blue-600' : 'bg-surface2'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      webcamMirror ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {(showPhonePanel || phone.status !== 'idle') && (
            <PhoneCameraPanel phone={phone} onDone={() => setShowPhonePanel(false)} />
          )}

          <RecordHero state={recorder.state} summary={heroSummary} />
        </div>
      </div>

      <footer className="mt-6 flex items-center gap-2 text-xs text-dim-app">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        {info.data
          ? `${info.data.name} ${info.data.version} · ${displays.data?.length ?? 0} display(s) · ${info.data.platform}`
          : 'Connecting…'}
      </footer>
    </section>
  );
}

function SectionLabel({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}): ReactElement {
  return (
    <label
      className={`mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-app ${className}`}
    >
      {children}
    </label>
  );
}

/** A labelled switch with an explanation — these options are not self-evident. */
const CursorToggle = memo(function CursorToggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="text-sm text-app2">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-app">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-blue-600' : 'bg-surface2'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
});

/** How the take is saved, as explicit choices rather than a buried setting. */
const FormatOption = memo(function FormatOption({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-[30%] flex-1 rounded-xl px-3.5 py-2.5 text-left transition ${
        active
          ? 'bg-blue-600/15 ring-1 ring-inset ring-blue-500/50'
          : 'bg-surface2 ring-1 ring-inset ring-transparent hover:ring-app'
      }`}
    >
      <span className={`block text-sm font-medium ${active ? 'text-blue-300' : 'text-app2'}`}>
        {title}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-app">{detail}</span>
    </button>
  );
});

/** Full-screen vs. selected-area, as two explicit choices rather than a toggle. */
const AreaOption = memo(function AreaOption({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-[46%] flex-1 rounded-xl px-3.5 py-2.5 text-left transition ${
        active
          ? 'bg-blue-600/15 ring-1 ring-inset ring-blue-500/50'
          : 'bg-surface2 ring-1 ring-inset ring-transparent hover:ring-app'
      }`}
    >
      <span className={`block text-sm font-medium ${active ? 'text-blue-300' : 'text-app2'}`}>
        {title}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-app">{detail}</span>
    </button>
  );
});

const TrackChip = memo(function TrackChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string | undefined;
  active: boolean;
  onClick: (next: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={() => onClick(!active)}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-blue-600 text-white' : 'bg-surface2 text-app2 hover:bg-surface2'
      }`}
    >
      {label}
      {hint && (
        <span className={`ml-1.5 text-xs ${active ? 'text-blue-100' : 'text-muted-app'}`}>
          ({hint})
        </span>
      )}
    </button>
  );
});

const DeviceSelect = memo(function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: CaptureSource[];
  value: string | null;
  onChange: (id: string) => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-app">
      <span className="w-20 shrink-0">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 truncate rounded-md bg-surface2 px-2 py-1.5 text-xs text-app2"
      >
        <option value="">Default device</option>
        {devices.map((d) => (
          <option key={d.id} value={d.deviceId ?? d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
});
