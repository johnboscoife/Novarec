# NovaRec — Privacy Policy

**Publisher:** Ife Solutions Ltd
**Software:** NovaRec desktop application
**Last updated:** 28 August 2026

The short version: **NovaRec is a local application.** Your recordings, your
settings and your credentials stay on your machine. Ife Solutions Ltd operates no
server that receives them, and NovaRec requires no account.

## What NovaRec stores, and where

| Data                                            | Where it lives                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Recordings and exported files                   | Your machine, in the folder you choose in Settings → Storage                                   |
| Capture setup and app preferences               | Your machine, in the application data folder                                                   |
| Export history                                  | Your machine, in the application data folder                                                   |
| LiveKit / Google credentials, if you enter them | Your machine, **encrypted at rest** by the operating system's own key store (DPAPI on Windows) |

Nothing in that table is transmitted to Ife Solutions Ltd.

## When NovaRec uses the network

NovaRec is usable entirely offline. It contacts the network only in these cases,
all of which follow from something you did:

1. **Update checks.** Packaged builds ask GitHub Releases whether a newer version
   exists. This request necessarily reveals your IP address and the version you
   are running to GitHub, whose own privacy policy applies. No identifier of you
   is attached by NovaRec.
2. **Meetings.** If you start or join a NovaRec meeting, audio and video are
   exchanged with the LiveKit server **you** configured. If you have not entered
   a server, no meeting traffic exists.
3. **Google Meet links.** Opening a Google Meet link hands it to your default
   browser. Google's own terms and privacy policy apply from that point.
4. **Phone camera pairing.** If you choose "Connect a phone", NovaRec opens a
   short-lived HTTPS server **on your local network only** so your phone's
   browser can reach it, and shows a QR code. Your phone's video then travels
   directly from the phone to this computer over your own Wi-Fi. It does not go
   through Ife Solutions Ltd, or through any other server on the internet — see
   below.
5. **Optional telemetry** — see below.

## Phone camera pairing (what the local server does)

Using a phone as a camera means this computer briefly accepts a connection from
your phone. Because that is a listening socket on your network, it is worth
saying exactly what it is and is not:

- It runs **only while you are pairing**, and shuts down when you disconnect,
  when the app quits, and automatically after five minutes idle.
- It is reachable **only on your local network**. It is never exposed to the
  internet, and NovaRec does not open any router port to make it so.
- Every request must carry the **one-time token embedded in the QR code**.
  Another device on the same Wi-Fi that has not scanned that code gets a
  refusal and nothing else.
- It serves exactly one page and a fixed set of connection-setup endpoints. It
  cannot read, list, or serve any file on your computer.
- A phone that reconnects — you reloaded the page, or the Wi-Fi dropped —
  replaces its own previous connection rather than being locked out. Only a
  device holding the token from your QR code can do this.
- Your phone will warn that the connection "isn't private". That is expected:
  the certificate is generated on your computer for that session and is not
  signed by a public authority. A browser requires an encrypted connection
  before it will let a page use the camera at all, which is why it exists.
- The **video itself never touches the server** — it flows directly between the
  two devices, encrypted, once they have found each other.

## Telemetry

Telemetry is **off by default** and stays off until you turn it on in
Settings → Privacy.

If you turn it on, NovaRec sends anonymous usage events only. The gate is
enforced in code (`prepareTelemetry` in `@novarec/shared`) and covered by tests:
it returns nothing at all unless you have opted in, and it strips personal
information from every event before it can leave. NovaRec does **not** send, and
the gate does not permit, file names, folder paths, window or screen titles,
recording content, transcripts, or anything derived from them.

You can turn telemetry back off at any time; the setting takes effect
immediately.

## Cameras, microphones and the screen

NovaRec captures your screen, camera and microphone only while you have a
recording, meeting or preview running, and only from the sources you selected.
Permission requests are limited to media devices, and:

- an **always-visible recording indicator** is shown while a recording is
  running, and cannot be disabled;
- in NovaRec meetings, recording does not start until every participant has
  consented, and a participant who joins mid-recording is asked before they are
  included.

## What Ife Solutions Ltd receives

Nothing, unless you choose to send it — for example by opening an issue in the
public repository and attaching information yourself.

## Children

NovaRec is not directed at children and collects no information about anyone.

## Your choices

- Change or clear the storage location: Settings → Storage.
- Turn telemetry on or off: Settings → Privacy.
- Remove credentials: clear the fields in Settings → Meetings.
- Uninstall NovaRec at any time. Uninstalling leaves your recordings in place, so
  that removing the app never destroys your work — delete them yourself if you
  want them gone.

## Changes

This policy may change in future releases. The version that applies to you is the
one shipped with the version of NovaRec you are running.

## Contact

Ife Solutions Ltd — via the project repository at
<https://github.com/johnboscoife/Novarec>.
