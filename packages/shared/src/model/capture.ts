import { z } from 'zod';
import { RectSchema } from './primitives.js';

/**
 * Capture-domain schemas that cross the IPC boundary, so they live in @shared
 * (the IPC contract is here and cannot depend on @novarec/capture). The pure
 * geometry/sustain logic that operates on these types stays in @novarec/capture.
 */

/** A physical display in the virtual desktop. `bounds` is DIP; capture crops
 * multiply by `scaleFactor` to reach physical pixels. */
export const DisplayInfoSchema = z.object({
  id: z.number(),
  bounds: RectSchema,
  scaleFactor: z.number().positive(),
  primary: z.boolean(),
  label: z.string().optional(),
});
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>;

/** The four selectable capture frame rates (mirrors SUPPORTED_TARGET_FPS). */
export const TargetFpsSchema = z.union([
  z.literal(24),
  z.literal(30),
  z.literal(60),
  z.literal(120),
]);
export type TargetFps = z.infer<typeof TargetFpsSchema>;

/** Shape of the floating webcam overlay (clipped in CSS, transparent corners). */
export const WebcamShapeSchema = z.enum(['circle', 'rounded', 'square']);
export type WebcamShape = z.infer<typeof WebcamShapeSchema>;

/** Commands the floating recording control can issue. `dismiss` is main-only. */
export const ControlActionSchema = z.enum([
  'pause',
  'resume',
  'stop',
  'dismiss',
  'toggleZoom',
  'muteMic',
  'toggleWebcam',
]);
export type ControlAction = z.infer<typeof ControlActionSchema>;

/** Recording state the main window publishes to the floating control. */
export const RecordControlStateSchema = z.object({
  state: z.enum(['idle', 'recording', 'paused']),
  elapsedMs: z.number().nonnegative(),
  micMuted: z.boolean(),
  micAvailable: z.boolean(),
  webcamOn: z.boolean(),
  /** The capture is zoomed toward the pointer right now. */
  zoomed: z.boolean().default(false),
  /** Zoom is switched on for this take, so the control is worth showing. */
  zoomAvailable: z.boolean().default(false),
});
export type RecordControlState = z.infer<typeof RecordControlStateSchema>;

/**
 * How a take is written.
 *
 * `single` records ONE muxed file — video and mixed audio together — so the
 * recording is finished and playable the moment it stops. `tracks` keeps every
 * source in its own file, which allows re-balancing audio or re-framing later
 * but requires a muxing pass to produce something watchable.
 */
/** How much bitrate a recording is given. Higher costs disk, not CPU. */
export const RecordingQualitySchema = z.enum(['balanced', 'high', 'best']);
export type RecordingQuality = z.infer<typeof RecordingQualitySchema>;

export const RecordingModeSchema = z.enum(['single', 'tracks']);
export type RecordingMode = z.infer<typeof RecordingModeSchema>;

/** Container for a finished single-file recording. */
export const RecordingContainerSchema = z.enum(['mp4', 'mkv']);
export type RecordingContainer = z.infer<typeof RecordingContainerSchema>;

export const ResolutionSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

/** A capture region persisted between sessions (spec: "Region persists"). */
export const SavedRegionSchema = z.object({
  rect: RectSchema, // DIP, virtual-desktop coordinates
  displayId: z.number().nullable(),
  updatedAt: z.string(),
});
export type SavedRegion = z.infer<typeof SavedRegionSchema>;

/** Persisted capture defaults for the Record module. */
export const CaptureSettingsSchema = z.object({
  targetFps: TargetFpsSchema,
  resolution: ResolutionSchema.nullable(), // null = source-native
  region: SavedRegionSchema.nullable(),
  // Persisted Record setup (restored on launch when "retain setup" is on).
  // `.default` keeps older settings files valid on load.
  sourceId: z.string().nullable().default(null),
  cameraOn: z.boolean().default(false),
  micOn: z.boolean().default(false),
  systemAudioOn: z.boolean().default(false),
  cameraDeviceId: z.string().nullable().default(null),
  micDeviceId: z.string().nullable().default(null),
  webcamShape: WebcamShapeSchema.default('circle'),
  webcamSize: z.number().int().positive().default(240),
  /**
   * Scale applied to the camera image inside its frame. Needed because some
   * cameras — Windows' phone "connected camera" especially — deliver a
   * landscape frame with the portrait phone image PILLARBOXED inside it. Those
   * black bars are part of the picture, so no amount of CSS fitting removes
   * them; only zooming past them does.
   */
  /** Zoom toward the pointer when the shortcut is pressed, and how far. */
  cursorZoomEnabled: z.boolean().default(true),
  cursorZoomScale: z.number().min(1.2).max(4).default(2),
  /** Draw a soft ring around the pointer. */
  cursorHighlight: z.boolean().default(false),
  /** Ripple on each click (needs the global hook; silently absent without it). */
  cursorClickEffects: z.boolean().default(false),
  /**
   * Leave the real pointer out of the capture and draw our own. Hiding it is
   * also what makes smoothing possible: a pointer burned into the source pixels
   * cannot be eased.
   */
  cursorHidden: z.boolean().default(false),
  cursorSmoothing: z.boolean().default(false),
  recordingQuality: RecordingQualitySchema.default('high'),
  recordingMode: RecordingModeSchema.default('single'),
  recordingContainer: RecordingContainerSchema.default('mp4'),
  webcamZoom: z.number().min(1).max(4).default(1),
  /** Mirror the image. Right for a selfie view, wrong for a rear camera. */
  webcamMirror: z.boolean().default(true),
});
export type CaptureSettings = z.infer<typeof CaptureSettingsSchema>;

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  targetFps: 30,
  resolution: null,
  region: null,
  sourceId: null,
  cameraOn: false,
  micOn: false,
  systemAudioOn: false,
  cameraDeviceId: null,
  micDeviceId: null,
  webcamShape: 'circle',
  webcamSize: 240,
  cursorZoomEnabled: true,
  cursorZoomScale: 2,
  cursorHighlight: false,
  cursorClickEffects: false,
  cursorHidden: false,
  cursorSmoothing: false,
  recordingQuality: 'high',
  recordingMode: 'single',
  recordingContainer: 'mp4',
  webcamZoom: 1,
  webcamMirror: true,
};

/** Raw `desktopCapturer` enumeration results (normalized by @novarec/capture). */
export const RawScreenSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayId: z.number(),
});
export type RawScreenSource = z.infer<typeof RawScreenSourceSchema>;

export const RawWindowSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type RawWindowSource = z.infer<typeof RawWindowSourceSchema>;

export const SourceListSchema = z.object({
  screens: z.array(RawScreenSourceSchema),
  windows: z.array(RawWindowSourceSchema),
});
export type SourceList = z.infer<typeof SourceListSchema>;
