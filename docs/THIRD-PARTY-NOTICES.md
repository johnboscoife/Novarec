# Third-party notices

NovaRec (© 2026 Ife Solutions Ltd, MIT Licence) is distributed with the
third-party components below. Each remains under its own licence.

## FFmpeg — GPL-3.0-or-later ⚠️

NovaRec bundles a static **FFmpeg** binary (via `ffmpeg-static`, build `b6.1.1`)
and uses it to transcode recordings on export. The bundled build is licensed
**GPL-3.0-or-later**; the full licence text ships beside the binary as
`ffmpeg.exe.LICENSE` and is installed with the application.

FFmpeg is invoked as a **separate process** over its command line. NovaRec's own
source is MIT-licensed and is not linked against FFmpeg.

Distributing a GPL-3.0 binary carries obligations on whoever distributes it —
including conveying the licence text (done: the file above ships with the app)
and making the corresponding source of that FFmpeg build available to
recipients. The upstream source for this build is published at
<https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1> and
<https://ffmpeg.org/download.html>.

> If you intend to distribute NovaRec commercially or under a licence
> incompatible with the GPL, review this with a lawyer, or replace the bundled
> build with an LGPL FFmpeg build (no GPL-only components) and dynamic linking.
> This notice is a factual record of what is shipped, not legal advice.

## Electron — MIT

Copyright © Electron contributors; copyright © 2013–2020 GitHub Inc.
<https://github.com/electron/electron>

Electron bundles Chromium (BSD-3-Clause and others) and Node.js (MIT). Their
licences are included in the installed application under `LICENSES.chromium.html`.

## React and React DOM — MIT

Copyright © Meta Platforms, Inc. and affiliates. <https://react.dev>

## LiveKit Client SDK — Apache-2.0

Copyright © LiveKit, Inc. <https://github.com/livekit/client-sdk-js>

## node-forge — BSD-3-Clause OR GPL-2.0

Copyright © Digital Bazaar, Inc. <https://github.com/digitalbazaar/forge>

Used (via `selfsigned`) to generate the short-lived TLS certificate for phone
camera pairing. NovaRec relies on it under the **BSD-3-Clause** half of its dual
licence, which imposes no copyleft obligation.

## Other MIT-licensed dependencies

- `zod` — copyright © Colin McDonnell
- `electron-updater` (electron-builder) — copyright © Stefan Judis, Vladimir Krivosheev
- `@tanstack/react-query` — copyright © Tanner Linsley
- `zustand` — copyright © Paul Henschel
- `tailwindcss` — copyright © Tailwind Labs, Inc.
- `selfsigned` — copyright © José F. Romaniello
- `qrcode-generator` — copyright © Kazuhiko Arase

Each MIT licence permits use, modification and redistribution provided the
copyright and permission notices are retained.
