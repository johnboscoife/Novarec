# Release notes

## 0.0.0 — first internal build

The **Record** product is usable end to end; **Meet** and **Studio** ship their
tested engines with live UIs in progress.

### Record (works today)

- Multi-track capture (screen + camera + microphone + system audio), each saved
  as an independent, time-aligned track.
- **Crash-proof recording** — append-only manifest, fsync-on-seal ~2s segments,
  automatic recovery of interrupted takes on next launch.
- Region selection overlay (multi-monitor, DPI-aware, snap-to-edge, persisted).
- Frame-rate capacity probe ("your machine can sustain X fps").
- Global hotkeys (start/stop, pause/resume, panic-stop) that work when unfocused,
  and a pre-recording countdown.
- **One-click export** to MP4 via FFmpeg, with a live progress bar and reveal.

### App

- First-run onboarding to your first recording.
- Settings: theme, reduced motion, storage, and privacy — **telemetry is off by
  default** and anonymized when enabled.
- Always-visible recording indicator; recording consent model for meetings.

### Engines ready (UI in progress)

- **Meet** — LiveKit room-token signing and the participant-consent ledger.
- **Studio** — scene graph, layer transform math, streaming targets, and
  automatic bitrate adaptation.
- **Editor** — timeline model (split/trim/ripple/remove-range), transcript-based
  cut ranges, and silence detection.

### Known limitations / next steps

- Meet needs a running LiveKit SFU and its meeting UI.
- Studio needs the WebGL2 renderer, RTMP egress, and virtual-camera drivers.
- Camera+screen compositing (WebGL2) and local Whisper transcription are pending.
- Installers are unsigned; production release needs code-signing/notarization
  certificates and auto-update hosting.

See [docs/STATUS.md](STATUS.md) for the full tested-vs-integration breakdown.
