# Phase 2 — Manual verification checklist

The durability guarantees are covered by the **automated** encoder suite
(`packages/encoder/src/*.test.ts`): append-only manifest, pause/resume → N+1
segments, duration accounting, **hard-kill recovery via a real killed
subprocess**, and disk-full graceful stop. That suite is the Phase 2 acceptance
and runs in CI.

What still needs a **real machine** (live capture can't run in the sandbox): the
capture → segment → playback round-trip. Run `pnpm dev`, open **Record**:

## Happy-path recording

- [ ] Pick a screen source, press **Record**. The indicator turns red and
      pulses; the elapsed timer counts up.
- [ ] After a few seconds, "N segments saved" increments (~every 2s).
- [ ] Press **Stop**. Open the recording folder under
      `%APPDATA%/NovaRec/recordings/<id>/` — it has `seg-000000.mp4`, … and a
      `manifest.jsonl`.
- [ ] Concatenate init + segments (or open the recovered file) and confirm it
      plays in VLC/mpv with the expected duration.

## Pause / resume integrity

- [ ] Record, **Pause**, wait, **Resume**, **Stop**. The number of segments is
      consistent with the pause count, and total playable duration ≈ the time
      spent actually recording (pauses excluded).

## Crash recovery (the headline)

- [ ] Start recording. After ~10s, **kill the app** (Task Manager → End task, or
      `Stop-Process`) — do **not** press Stop.
- [ ] Relaunch NovaRec → Record. The amber **"N recordings can be recovered"**
      banner appears listing the interrupted take.
- [ ] Click **Recover**. A `recovered.mp4` is written in the recording folder;
      confirm it plays and contains everything up to (about) the kill moment.
- [ ] The banner clears (it's no longer an orphan).

## Disk-full (optional, destructive)

- [ ] On a small/full volume, recording should **stop gracefully** with a
      disk-full message, and the already-saved segments must still play. (The
      automated suite covers this deterministically via an injected ENOSPC.)

> Encoder note: recording uses **MediaRecorder** (fragmented MP4) per
> [ADR-0005](DECISIONS/0005-recording-encoder.md); WebCodecs+mp4box is reserved
> for Phase 7 export.
