# NovaRec

**OBS's engine behind Clipchamp's front door.** One capture engine, one
compositor, one media pipeline — powering three things people usually need three
apps for:

- **Record** — a professional screen recorder (multi-track, region capture,
  crash-proof recording, straight to MP4 or MKV with no export step).
- **Meet** — multi-party video meetings with per-participant recording and
  transcripts (LiveKit-backed).
- **Studio** — a scene-based live compositor and streaming engine (OBS class).

Cross-platform desktop app (Electron + React 19 + TypeScript strict). Everything
works **offline**; cloud features are additive and optional.

## Status

Record is the furthest along: capture → durable segmented storage → finalize →
**FFmpeg export** works end to end. Meet and Studio have their engines built and
tested; their live UIs are in progress. See **[docs/STATUS.md](docs/STATUS.md)**
for the per-feature breakdown of what's shipped vs. in progress.

Every correctness-critical guarantee is enforced by tests (128+):

- **Never lose a recording** — append-only manifest, fsync-on-seal segments, and
  crash recovery proved by a real killed-subprocess test.
- **Nothing is silently dropped** — a take records to one finished file by
  default; choosing separate tracks keeps every source in its own writer.
- **Privacy by default** — no telemetry leaves the device unless you opt in;
  recording indicator can't be disabled; meeting recording requires consent.

## Getting started

```bash
corepack enable pnpm      # or: npm i -g pnpm@9
pnpm install
pnpm dev                  # launch the app with hot reload
```

Common tasks:

```bash
pnpm test                 # unit tests (Vitest)
pnpm typecheck            # strict TypeScript across all packages
pnpm lint                 # ESLint (no `any`, flat config)
pnpm --filter @novarec/desktop build   # produce a platform installer
```

Requirements: Node ≥ 20.11 and pnpm 9. **FFmpeg is bundled** (via
`ffmpeg-static`) for both development and packaged builds — no system install
needed. Override with `NOVAREC_FFMPEG` if you prefer your own binary.

## Repository layout

```
apps/
  desktop/    Electron app (main · preload · renderer)
  server/     Fastify signaling (LiveKit tokens)
packages/
  shared/     Zod schemas, types, IPC contract, constants
  capture/    source enumeration, region geometry, FPS sustain
  encoder/    append-only segment writer, crash recovery, FFmpeg export
  overlay/    cursor zoom, redaction, markers, annotations
  timeline/   editing model (split/trim/ripple/transcript/silence)
  compositor/ scene graph + layer transform math
  ui/         shared design system
e2e/          Playwright end-to-end tests
docs/         ARCHITECTURE · IPC · STATUS · DECISIONS (ADRs)
```

## Architecture

The shared core is the whole point — see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
Significant decisions are recorded as ADRs in
**[docs/DECISIONS/](docs/DECISIONS/)**.

## Security & privacy

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on, strict CSP.
- Every IPC payload validated with Zod on both ends.
- Redacted pixels are never written to disk.
- Telemetry is strictly opt-in and anonymized; see the Settings screen.

## Legal

NovaRec is published by **Ife Solutions Ltd**.

- [MIT Licence](LICENSE)
- [Terms of Use](docs/TERMS.md)
- [Privacy Policy](docs/PRIVACY.md) — recordings stay on your machine; telemetry
  is off by default
- [Third-party notices](docs/THIRD-PARTY-NOTICES.md) — note that the bundled
  FFmpeg binary is **GPL-3.0-or-later**

The Windows installer shows these terms as an agreement page before installing.
