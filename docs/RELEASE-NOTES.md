# Release notes

## 0.0.48 — a camera that never answers no longer spins forever

0.0.47 added retry-with-backoff for a camera that fails to open. It never ran,
because the failure this camera produces isn't a failure — the driver accepts
the request and then **never answers at all**. The await never settled, so there
was no error to back off from and nothing to report: just a spinner.

Three changes:

- **Opening a camera now has a deadline.** If a driver hasn't answered in eight
  seconds, that is treated as a failure — reported, and retried with the backoff
  that already existed. "That camera did not respond" beats an endless spinner.

- **A camera that moves is found again.** Windows reassigns the phone
  "connected camera" a new device id every time it re-registers, which left an
  exact-id match permanently unmatchable — the camera was gone forever until you
  re-picked it by hand. The overlay now knows the camera's _name_ and re-finds
  it when the id changes. This is not the silent substitution removed in 0.0.47:
  it matches the name you chose, and only that name.

- **Opened but silent is now visible.** A virtual camera can connect and then
  send nothing. If no picture arrives within six seconds you get "Connected, but
  no video yet — check the phone is streaming" rather than a black circle.

Worth being straight about the limit: these turn a silent spinner into an honest
report, and recover from an id change. If the phone itself isn't streaming to
Windows, no change here can make it — the message will now tell you that is what
is happening.

## 0.0.47 — the floating camera stops opening the wrong one, and stops spinning

Two faults in the floating camera window, both showing up with Windows' phone
"connected camera", which registers and unregisters as the phone comes and goes.

### It opened a different camera than the one you chose

If the selected camera could not be opened, the window quietly fell back to
"whatever is the default camera" and floated that on screen — while the picker
still named the camera you asked for. In a window that is recorded into your
video, that can put an entirely different room on camera without a word.

It no longer substitutes. If the chosen camera cannot open, the window says so,
naming what went wrong — in use by another app, unavailable, or blocked.

### It retried forever instead of settling

When a camera's track ended, the window re-acquired it immediately, with no
delay and no limit. A camera that drops in and out — exactly what a phone-backed
virtual camera does — sent that into a tight loop that never settled, which is
what "it just keeps rolling" was.

Retries now back off (half a second, doubling, capped) and give up after six
attempts with an explanation rather than spinning.

### And it tells you what it is doing

A camera that is registered but not yet sending video reports itself as muted
rather than failing, which previously looked like a frozen window. The overlay
now shows "Waiting for the camera to send video…", and shows a real message
while connecting or after a failure, instead of a blank square.

### Devices are released properly

Single-file recording never closed the sources it opened — the system-audio
loopback especially — so they stayed held after a take. And a borrowed stream (a
paired phone's camera) was being stopped by the recorder, killing a device it
never opened. Ownership is now explicit: NovaRec closes exactly what it opened,
and nothing it was lent.

## 0.0.46 — two ways single-file recording lost your audio and video

Both found by auditing 0.0.45 rather than by hitting them, and both are the
same shape: something recorded fine and then quietly wasn't in the file.

### A camera was dropped from single-file recordings

One file carries one video track. With both a screen and a phone camera
running, 0.0.45 took the first video track and discarded the rest — so the
camera showed a live preview, reported itself as recording, and was simply
absent from the result.

Screen and camera are now composited as they are captured, camera
picture-in-picture, matching the layout the export already used for
separate-track takes — so a recording looks the same whichever mode made it. If
compositing fails, the screen is still recorded and the failure is reported,
rather than a take quietly arriving without the camera in it.

### A stream copy dropped an audio source

Exporting a separate-track recording with one of the no-re-encode presets kept
only one audio stream. FFmpeg's default stream selection takes one stream of
each kind, and a copy cannot mix — mixing is processing. So a screen +
microphone + system audio take came out missing an audio source, silently.

Every input is now mapped explicitly, so all of them land in the file as
separate tracks. Verified against FFmpeg: three streams out where there were
two before.

## 0.0.45 — records straight to MP4 or MKV

Stop the recording and the file is there. No export step, no queue, no waiting
on an encode.

### What changed

NovaRec used to record every source as its own track and then mux them together
in a separate export. That is excellent for editing later and a poor answer to
"I just want the video".

There is now a **Save as** choice on the Record page:

- **MP4** — one file, plays everywhere. Ready seconds after you stop.
- **MKV** — one file, ready the instant you stop. Nothing is re-encoded at all.
- **Separate tracks** — the old behaviour, kept because re-balancing microphone
  against system audio afterwards is genuinely useful and impossible once they
  are mixed.

Single-file is now the default.

### How it stays fast, and honest

In single-file mode the screen and every audio source are mixed **as they are
captured**, so what lands on disk is already one playable recording. Finishing it
re-wraps that file into the container you chose — a stream copy at disk speed,
not an encode. A four-minute take finishes in about a quarter of a second.

MP4 does one extra thing: it converts the audio. Chromium sometimes records
Opus, which is legal inside MP4 but rejected by QuickTime, most editors and some
browsers. **The video is never re-encoded** — only the audio, which is what makes
the file open anywhere. Choose MKV if you want literally zero processing.

MP4 files also now get their index written at the front, so they seek properly
and can be uploaded or shared without waiting for the whole file.

### What you give up

Mixing at capture time means the microphone and system audio are summed into one
track and cannot be balanced separately afterwards. Muting the mic mid-recording
still works. If you need that separation, pick **Separate tracks**.

Crash safety is unchanged: recordings are still sealed to disk continuously, and
an interrupted take is still recoverable.

## 0.0.44 — zoom the camera to fill its frame, and pair a phone by cable

### Zoom, so the circle is full of you

A phone used as a webcam usually sends a **portrait picture inside a landscape
frame**, with black bars baked into the video itself. Windows' connected camera
does exactly this. Those bars are part of the picture, so no amount of fitting
removes them — the round camera frame ended up with black down both sides.

There is now a **Zoom** slider (1×–4×) under the floating camera controls. It
crops in from the centre, which is precisely where a pillarboxed camera keeps
its real picture. It applies live, including mid-recording.

A **Mirror** toggle sits beside it. Mirroring is right for a selfie view and
wrong for a rear camera or anything with text in shot, and it was previously
forced on.

### Pair a phone over a USB cable

Plug the phone in, turn on USB tethering, and pair exactly as before — the QR
code, or the address, now points across the cable. Steadier than Wi-Fi, and it
works where there is no shared network at all.

This needed no new transport: tethering puts both devices on one small network
across the cable, so the existing pairing runs over it. What it did need was
picking the **right** address. A tethered phone can only reach this computer at
its tethered address, never its Wi-Fi one — advertise the wrong one and the QR
code simply never connects. USB adapters (Android's Remote NDIS, iPhone's Apple
Mobile Device Ethernet) are now recognised and preferred when present.

And because only you know which cable or network the phone is actually on, the
pairing screen lists every address it could be reached at — labelled **USB
cable** or **Wi-Fi**, with the adapter name — so a wrong guess takes one click
to correct rather than leaving you staring at a QR code that never resolves.

## 0.0.43 — fixes the 0.0.42 launch crash

0.0.42 would not start. It showed "A JavaScript error occurred in the main
process" with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Sorry — that one
was entirely self-inflicted.

**What happened.** Internal workspace packages ship TypeScript source with no
build step, so they have to be _bundled_ into the main-process output. The list
of which packages those are was maintained by hand. 0.0.42 added
`@novarec/overlay` as a dependency (for markers → chapters) without adding it to
that list, so it was left as an external `require()` — and the packaged app tried
to load a raw `.ts` file out of `app.asar` at startup and died immediately.

**The fix, and why it can't recur.** The list is no longer hand-written: it is
derived from `package.json`, where anything declared `workspace:*` is internal
by definition. Adding a workspace dependency now bundles it automatically.

**Why it shipped at all.** The build succeeded, every gate passed, and 226 tests
were green — because none of that launches the app. The smoke test that _does_
launch it exists and catches this in seconds, but it was not part of the release
checks. It now runs in CI immediately after the build, on Windows and macOS.
Building something is not evidence that it runs.

Everything in 0.0.42 — markers becoming chapters, the disk-space warning, the
unbound dead shortcuts — is unchanged and now actually reachable.

### Also: auto-update has never actually run

Launching the packaged app printed `Auto-update unavailable: Cannot set
properties of undefined`. `electron-updater` is CommonJS, and once bundled into
the main process its dynamic import exposes the module under `.default` rather
than as named exports — so `autoUpdater` was `undefined`, the resulting
TypeError was caught by the defensive handler, and updates were reported as
"unavailable" and skipped. Silently, in **every** packaged build since the
feature was added, including the published release.

Both module shapes are now accepted. Installed copies from 0.0.43 onward will
actually see new versions.

## 0.0.42 — markers become chapters, and no more shortcuts that do nothing

### Mark a moment while recording

Press **Ctrl+Shift+M** — or the **Mark** button next to the timer — and NovaRec
bookmarks that instant. On export those bookmarks become **real chapters in the
MP4**, the kind players and YouTube show in the scrubber. No more scrubbing back
through forty minutes to find the bit that mattered.

Markers are written to the recording's own folder as they happen, append-only,
so a bookmark survives exactly what the footage survives. The chapter titles are
escaped properly — a stray `=` in a title silently truncates an FFmpeg metadata
file, which is the sort of thing that only shows up in the finished export.

### Two shortcuts that quietly did nothing

`Ctrl+Shift+A` (annotate) and `Ctrl+Shift+Z` (cursor zoom) were registered
**system-wide** and listed in Settings, but nothing was behind them. That took
those combinations away from every other app on the machine while telling you
they worked. They are now unbound until the features that need them exist. The
actions remain in the model, so nothing is lost when they land.

`Ctrl+Shift+M` was in the same state — it now does what it always claimed to.

### Low disk space is called out before you record

A warning appears when the volume your recordings are saved to is running low,
with a stronger one under a gigabyte. The recorder already survived a full disk
by sealing what it had and stopping cleanly, but a take cut short is still a
take cut short. It stays silent above the threshold, and stays silent when the
volume can't be read rather than claiming a full disk it hasn't measured.

### Internals

- Pause, resume and stop timestamps in a recording's manifest were written from
  `performance.now()` — time since the app's window loaded — while every other
  offset in the same file is cumulative recorded time. Nothing read them yet, so
  nothing was broken, but a durable file that outlives the session had two
  incompatible clocks in it. They are now on one.
- Removed a dead placeholder component left over from before Meet and Studio had
  real screens.

## 0.0.41 — your Windows 11 phone camera is filed as a phone

The mystery camera turned out to be Windows 11's **connected camera**: a phone
paired through Settings → Mobile devices, which Windows registers as
"<your phone's name> (Windows Virtual Camera)". It appears and disappears as the
phone connects, which is why it seemed to keep popping up.

NovaRec was filing it under ordinary virtual cameras, alongside OBS, purely
because the label ends in "Virtual Camera" — so the one entry that actually
_was_ the user's phone was the one place it didn't appear. It now lands in
**Phone cameras**, where it belongs. Genuinely non-phone virtual cameras (OBS,
XSplit, NVIDIA Broadcast, ManyCam) are still classified separately.

The setup help now leads with this route on Windows 11, since it needs nothing
installed on either device — and because it produces a real camera device, the
draggable floating overlay works with it, which the Wi-Fi pairing route cannot
offer.

## 0.0.40 — phone camera switching actually works, and no more surprise camera window

### "Could not switch camera — still on the previous one"

My fault, and the reason was in the previous fix. When you tapped flip, the page
asked for the next camera **while the current one was still open**. A phone can
rarely hold two cameras open at once, so that request failed every single time
and the page dutifully reported it.

The camera is now released before the next one is opened, and switching cycles
**real device ids** instead of asking for the opposite `facingMode` — which is
only a hint, often hands back the same camera, and cannot address a third lens
at all. Your phone's cameras are now listed by name in a picker on the page, so
you can choose the ultra-wide or telephoto directly rather than only toggling
front/rear. If a camera genuinely can't be opened, the previous one is reopened
so a failed switch never leaves you with a dead picture.

### A camera window popping up on its own

When the phone link dropped, NovaRec cleared the phone as your selected camera
but left the camera itself switched **on** — so the floating webcam overlay
opened on whatever local webcam happened to be the default, apparently out of
nowhere. Combined with the flip bug above, which dropped the link constantly,
that window kept reappearing.

Losing the phone now switches the camera off. It does not silently substitute a
different one: that is a decision only you should make.

### Camera list stability

Some virtual-camera drivers register and unregister repeatedly, firing device
change events in bursts. Re-enumerating on every one made the camera list
flicker and could pull the selection out from under a click. Enumeration is now
debounced, and duplicate entries from a driver mid-reinstall are filtered out.

## 0.0.39 — phone camera: flipping no longer freezes, and it's in the camera list

Both fixes come from real use of 0.0.38 on an actual phone.

### Flipping the camera froze the picture

Tapping **Flip camera** tore the whole connection down and sent a fresh offer.
The server treated that second offer as a different device trying to muscle in
and refused it, so the phone landed on "this link has expired" while the desktop
sat holding a dead connection — showing its last frame, which is exactly what a
freeze looks like.

Flipping now swaps the camera on the existing connection (`replaceTrack`), with
no renegotiation at all: instant, and nothing to go wrong in between. If the
swap fails, it stays on the camera you were already using and says so, rather
than dropping you into a broken state.

Separately, the server now treats a repeat offer as a **reconnect** rather than
an intruder. Reloading the phone page, or recovering from a dropped Wi-Fi link,
reconnects instead of stranding you — previously the only way back was
restarting pairing on the desktop. The one-time token from the QR code is still
the gate, so this grants nothing to a device that never scanned it. Stale
connection state is dropped on reconnect so it can't corrupt the new link, and
the desktop rebuilds its side instead of leaving the old frozen frame up.

### The paired phone is now a camera you can pick

It only ever appeared in its own preview panel, never in the **Camera** list —
so it did not look like a camera source at all. It now appears under
**Phone cameras** as "Phone over Wi-Fi (paired)", and pairing selects it for
you, since that is unambiguously what you meant.

Choosing it means the phone is what gets recorded: it becomes its own track and
is placed picture-in-picture in the export. There is no floating overlay window
in that case — the overlay captures a local device by id, and a Wi-Fi phone has
none. When the phone disconnects, the selection is handed back rather than
leaving a dead entry selected, and a phone id is never restored at launch, when
nothing is paired yet.

## 0.0.38 — use your phone as a camera, over Wi-Fi, with no app

Scan a QR code and your phone's camera streams straight into NovaRec. No
companion app on either device, no account, and the video never leaves your
network — it goes directly from the phone to your computer.

### How it works

`getUserMedia` only runs in a secure context, and `http://192.168…` is not one,
so NovaRec starts a short-lived local **HTTPS** server and shows a QR code
pointing at it. Your phone opens that page, grants camera access, and negotiates
a direct WebRTC connection. The main process only relays the four setup
messages; the media itself flows peer-to-peer between the two devices and is
never seen by the server, let alone by us.

Your phone will warn that the connection "isn't private". That is expected and
called out in the UI before you scan: the certificate is generated on your
computer for that session alone, and an encrypted connection is simply the price
of a browser letting a page use the camera at all.

### The listening socket, and what constrains it

This opens a port on your LAN, so it is deliberately boxed in — and the box is
covered by integration tests that run against the real server:

- it runs **only while pairing**, and stops on disconnect, on quit, and after
  five minutes idle;
- **every** request must carry the one-time token embedded in the QR code —
  page and endpoints alike. Anything else gets a 403 and no information;
- it serves one page and a fixed set of setup endpoints. There is no path
  routing to the filesystem: `/etc/passwd`, `/../package.json` and friends are
  plain 404s even _with_ a valid token;
- **one phone per session** — a second device is refused rather than taking
  over a live camera;
- starting a new session tears the previous one down, so no listener is ever
  orphaned.

`docs/PRIVACY.md` and the installer's terms now describe all of this.

### Where the phone video ends up

It is recorded as its own track, in sync with everything else, and the export
compositor places it picture-in-picture in the corner — the same path the local
camera already used. Nothing new to configure.

### Also

- Picking the right network address is its own trap: a Windows machine typically
  has several, and most (Hyper-V, WSL, VirtualBox, Docker, VPN adapters) are
  host-only networks a phone can never reach. The chooser ranks real LAN
  addresses and skips those, so the QR code points somewhere the phone can
  actually get to. Unit-tested against real adapter layouts.

## 0.0.37 — mic level meter, phone cameras, and an export-fallback fix

### Fixed: a missing NVIDIA driver failed the whole export

Regression from 0.0.36. On a machine with no NVIDIA GPU, `h264_nvenc` fails to
open and FFmpeg reports it as an EPERM out of the filter graph —
`Error while filtering: Operation not permitted`. That phrase reads like a file
permission problem, and 0.0.36's new "don't retry environmental failures" guard
matched it, so the export gave up instead of falling back to QuickSync or
software. Encoder-open failures are now detected first and always fall back; the
environmental test is narrow and file-specific (`no space left`,
`permission denied`, `read-only file system`). Exit codes are shown signed, too —
Windows was reporting FFmpeg's `-1` as `4294967295`.

### Microphone level meter

The camera has always had a preview; the microphone had nothing, so a muted or
wrong input only announced itself after the take. There is now a live segmented
meter under the microphone picker — green through the usable range, amber when
it is getting hot, red where it will clip, with a held peak for transients. It
opens its own capture of the device, so it works before recording starts, and it
is never routed to the speakers (that would feed straight back into the
recording). If the device cannot be opened at all, it says so instead of sitting
at zero.

### Phone cameras are findable now

A phone used as a webcam reaches NovaRec through its companion app's virtual
camera driver, so it was always selectable — it just looked like one more
cryptic entry in a flat list. The camera picker now groups **Phone cameras**
separately, detects Iriun / DroidCam / Camo / EpocCam / iVCam and Continuity
Camera by driver name, confirms when one is connected, and links to the apps
when none is. Non-phone virtual cameras (OBS, NVIDIA Broadcast, ManyCam) are
classified separately so they aren't offered as phones.

Direct Wi-Fi pairing — NovaRec streaming from the phone's browser with no
third-party app — is the next step, and is deliberately not faked in this build.

## 0.0.36 — export reliability, and an end to false stall warnings

### Two exports of one recording could destroy each other

Every export re-runs `finalizeTrack`, which rebuilds `track.mp4` **inside the
recording folder** and then reads it for the whole encode. Two overlapping
exports of the same recording meant one truncating and refilling the very file
the other was still reading — the first died partway through with a decode
error while the second completed. Fixed at both levels:

- **Exports are now serialized in the main process.** The renderer already had a
  queue, but that is a UI convenience, not a guarantee: a reloaded renderer or
  any other caller of `export:run` sailed straight past it. Main owns the
  invariant now.
- **`concatToFile` is atomic** — it builds a temp sibling and renames into
  place. Opening the destination `'w'` truncated it instantly and then refilled
  it over several seconds, so anything reading that path meanwhile (another
  export, a media player) saw a truncated file. A crash mid-concat used to leave
  the same wreckage permanently.

### A failed export now tells you what went wrong

FFmpeg rewrites its status line in place with a bare carriage return and no
newline, so splitting stderr on `?` returned the whole progress stream as
one "line" — and that is what got reported as the error: a wall of
`frame=… size=… speed=…` with the actual cause nowhere in it. Progress lines are
now filtered out, the head of the log is kept as well as the tail (the useful
part is printed up front and used to get evicted), FFmpeg's generic
"Conversion failed!" trailer no longer masks the specific line above it, and the
exit code or signal is **always** included.

### "Screen stopped producing data" was usually wrong

Screen capture is change-driven: Chromium delivers a frame only when the picture
changes, so a still screen legitimately produces no data. Timing out on that
reported a stall every time the user simply stopped moving the mouse — including
right before pausing. The watchdog now reports a capture that has genuinely
ended (screen sharing stopped, device unplugged), and keeps the timing check
only for audio-only tracks, where a gap really is a fault.

### Region capture: a still screen recorded as nothing

The crop redrew its canvas only when a new source frame arrived. Chained with
change-driven capture — and with `captureStream()`, which emits a frame only
when the canvas is modified — a still screen produced no canvas frames at all,
so the recorder got no data and the take had a hole in it. The crop now redraws
on a steady tick at the target frame rate, so a still screen records as still
video, which is what it is.

### Hardware-encoder fallback

A GPU encoder that fails **mid-encode** (driver reset, session limit, another
app taking the encoder) now falls back to software instead of failing the
export. Previously any failure after progress was treated as fatal on the theory
that it would recur — true for a full disk, not for the GPU. Genuinely
environmental failures (no space, permission denied) still fail fast rather than
burning minutes on a doomed re-encode.

## 0.0.35 — record just an area, a rebuilt Record page, and installer terms

### Region capture actually crops now

"Selected area" is back on the Record page, and this time it records what it
says. Previously the picker existed but the crop was never applied — it recorded
the whole screen — so the control was hidden rather than shipped as a lie.

- `getDisplayMedia` can only hand back a whole display, so the crop is applied to
  the captured frames before they reach the encoder (`cropStream.ts`), driven by
  the pure, unit-tested `cropForRegion` mapping in `@novarec/capture`.
- A region capture lifts the 1080p capture cap to near-native, because only the
  cropped rect is encoded — a small area stays sharp instead of being upscaled
  from a downscaled frame. The output is still capped at 1080p.
- Picking an area now selects the screen it was drawn on, so the crop and the
  captured frames can never disagree. An area over a _window_ capture is
  refused with an explanation instead of being silently ignored.

### The area picker now covers every monitor, and lines up with the cursor

Two bugs in the selection overlay, both from it being **one window sized to the
whole virtual desktop**:

- **Other monitors were unreachable.** `enableLargerThanScreen` is macOS-only, so
  Windows clamped that window to a single display — you could never draw on a
  second screen.
- **The selection was offset from the cursor.** A window straddling displays gets
  one device scale factor for its entire web contents, so its CSS pixels stopped
  matching virtual-desktop DIP on any scaled monitor. The on-screen hint was
  centred on the virtual desktop rather than on a screen, for the same reason.

There is now **one overlay window per display**. Each sits entirely on one
monitor, where 1 CSS pixel is exactly 1 DIP, so a rect converts to virtual
coordinates by adding the display origin — no scaling, no drift
(`overlayRectToVirtual`, pure and unit-tested). Starting a drag on one screen
clears any selection on the others, each overlay names its monitor, and the
confirm toolbar is clamped inside the screen.

### Record page rebuilt

- A new banner sits beside the setup card and shows, at a glance, exactly what
  the next take will capture: source, area, extra tracks, and frame rate.
- Full screen vs. selected area are two explicit choices, not a hidden toggle.
- The capacity panel is gone from this page (see below); the durability promise
  it used to spell out now reads as one line in the banner.
- Capture setup is persisted on a trailing edge and the floating webcam is
  re-placed on a debounce — dragging the size slider was previously one disk
  write and one IPC call _per pixel_.
- Derived lists and the leaf controls are memoized, so the 5-per-second recording
  timer no longer re-renders the whole setup form.

### Capacity check moved to Settings → Performance

It is a one-off measurement of the machine, not a per-take decision, and it
animates the screen for three seconds — which has no place in the middle of
setting up a recording. It now writes its recommendation straight into the
recording frame rate.

### Installer, publisher and legal

NovaRec is published by **Ife Solutions Ltd**. The Windows installer now shows a
Terms of Use / licence / privacy agreement page before installing
(`apps/desktop/build/license.txt`), and uninstalling explicitly leaves your
recordings and settings in place. The publisher, copyright and MIT licence
holder are set throughout, and Settings gained an **About & legal** panel linking
to the Terms, Privacy Policy, licence and third-party notices.

Third-party notices are now documented — including that the bundled **FFmpeg
binary is GPL-3.0-or-later**, which carries obligations on anyone redistributing
NovaRec. See `docs/THIRD-PARTY-NOTICES.md`.

### Fixes

- The **Mute microphone** global shortcut (Ctrl+Shift+U) did nothing. It was
  registered system-wide and listed in Settings, but Record ignored it. Now it
  drives the same path as the floating control bar.
- `@novarec/shared` did not type-check at all (`URL` was missing from the
  configured lib). CI never caught it because the workflow only triggered on
  `main` while this repo's default branch is `master`. Both fixed.

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
- Installers are self-contained (FFmpeg is bundled) but **unsigned**. A
  tag-triggered release workflow (`.github/workflows/release.yml`) builds all
  three platforms; adding code-signing/notarization secrets makes them
  production-ready. Auto-update hosting is still to configure.

See [docs/STATUS.md](STATUS.md) for the full tested-vs-integration breakdown.
