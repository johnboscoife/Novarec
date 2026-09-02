/**
 * The page the phone loads after scanning the QR code.
 *
 * Served as one self-contained document — no external scripts, styles, or
 * fonts — so it works on a phone with no internet, loads instantly over the
 * LAN, and needs no CSP exceptions.
 *
 * The PHONE is the offerer: it owns the camera, so it creates the peer
 * connection and the offer, and the desktop answers. Signalling rides on plain
 * HTTP polling against this same server rather than a WebSocket, which keeps
 * the dependency surface at zero for a handshake that exchanges four messages.
 */
export function mobilePageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>NovaRec camera</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100dvh; background: #0a0a0a; color: #f5f5f5;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
  }
  h1 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin-top: 6px; font-size: 13px; color: #8a8a8a; text-align: center; }
  #status {
    margin-top: 14px; padding: 9px 14px; border-radius: 999px; font-size: 13px;
    font-weight: 500; background: #1c1c1c; display: flex; align-items: center; gap: 8px;
  }
  #dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
  #status.live #dot { background: #10b981; }
  #status.live { background: rgba(16,185,129,.14); color: #6ee7b7; }
  #status.err { background: rgba(239,68,68,.14); color: #fca5a5; }
  #dot.busy { animation: p 1.1s ease-in-out infinite; }
  @keyframes p { 50% { opacity: .3 } }
  video {
    width: 100%; max-width: 460px; margin-top: 18px; border-radius: 16px;
    background: #151515; aspect-ratio: 3/4; object-fit: cover;
  }
  select {
    width: 100%; max-width: 460px; margin-top: 12px; padding: 12px 14px;
    border: 0; border-radius: 12px; background: #1c1c1c; color: #f5f5f5; font-size: 15px;
  }
  .row { display: flex; gap: 10px; margin-top: 12px; width: 100%; max-width: 460px; }
  button {
    flex: 1; padding: 13px 16px; border: 0; border-radius: 12px; font-size: 15px;
    font-weight: 600; color: #fff; background: #2563eb; cursor: pointer;
  }
  button.ghost { background: #1c1c1c; color: #d4d4d4; }
  button:disabled { opacity: .5 }
  .hint { margin-top: 16px; font-size: 12px; line-height: 1.6; color: #5f5f5f; text-align: center; max-width: 460px; }
</style>
</head>
<body>
  <h1>NovaRec camera</h1>
  <p class="sub">Keep this page open while you record.</p>
  <div id="status"><span id="dot"></span><span id="msg">Starting camera…</span></div>
  <video id="preview" playsinline autoplay muted></video>
  <select id="cameras" aria-label="Camera"></select>
  <div class="row">
    <button id="flip" class="ghost">Flip camera</button>
    <button id="stop">Disconnect</button>
  </div>
  <p class="hint">Your video goes straight to NovaRec on your computer over this Wi-Fi network. It is not uploaded anywhere.</p>

<script>
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var statusEl = document.getElementById('status');
  var msgEl = document.getElementById('msg');
  var dotEl = document.getElementById('dot');
  var video = document.getElementById('preview');
  var flipBtn = document.getElementById('flip');
  var picker = document.getElementById('cameras');

  var pc = null, stream = null, polling = null, stopped = false;
  // Real camera devices, cycled by id. facingMode is only a HINT — on many
  // phones asking for the "other" facing mode returns the same camera, and it
  // cannot address a third lens at all. Device ids are exact, which is also
  // what makes this behave like any ordinary camera picker.
  var cameras = [], cameraIndex = 0;

  function setStatus(text, state, busy) {
    msgEl.textContent = text;
    statusEl.className = state || '';
    dotEl.className = busy ? 'busy' : '';
  }

  function api(path, options) {
    var opts = options || {};
    opts.cache = 'no-store';
    return fetch(path + '?t=' + encodeURIComponent(token), opts);
  }

  function stopStream() {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }

  /**
   * Open one camera. The current one is ALWAYS released first: a phone can
   * rarely hold two cameras open at once, so requesting the next while the
   * previous is still live is what made switching fail outright.
   */
  async function openCamera(index) {
    stopStream();
    var constraints = { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } };
    var device = cameras[index];
    if (device && device.deviceId) constraints.video.deviceId = { exact: device.deviceId };
    else constraints.video.facingMode = index % 2 === 0 ? 'environment' : 'user';
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraIndex = index;
    video.srcObject = stream;
    picker.value = String(index);
    return stream.getVideoTracks()[0];
  }

  /** Labels only exist after permission has been granted at least once. */
  async function refreshCameras() {
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      cameras = devices.filter(function (d) { return d.kind === 'videoinput'; });
    } catch (e) {
      cameras = [];
    }
    picker.innerHTML = '';
    cameras.forEach(function (d, i) {
      var option = document.createElement('option');
      option.value = String(i);
      option.textContent = d.label || 'Camera ' + (i + 1);
      picker.appendChild(option);
    });
    picker.style.display = cameras.length > 1 ? '' : 'none';
    flipBtn.disabled = cameras.length < 2;
    picker.value = String(cameraIndex);
  }

  /** Swap the live camera on the existing connection — no renegotiation. */
  async function switchTo(index) {
    var sender = pc && pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
    if (!sender) { teardown(); start(); return; }
    var previous = cameraIndex;
    flipBtn.disabled = true;
    picker.disabled = true;
    try {
      var track = await openCamera(index);
      await sender.replaceTrack(track);
      setStatus('Live — you are on camera', 'live', false);
    } catch (e) {
      // Reopen what we were using so a failed switch never leaves a dead camera.
      try {
        var restored = await openCamera(previous);
        await sender.replaceTrack(restored);
        setStatus('That camera is unavailable — staying on the previous one', 'err', false);
      } catch (e2) {
        setStatus('Lost the camera — reload this page', 'err', false);
      }
    } finally {
      flipBtn.disabled = cameras.length < 2;
      picker.disabled = false;
    }
  }

  async function start() {
    stopped = false;
    try {
      await openCamera(cameraIndex);
    } catch (e) {
      setStatus('Camera blocked — allow access and reload', 'err', false);
      return;
    }
    // Enumerate only AFTER permission, or the labels come back empty.
    await refreshCameras();
    setStatus('Connecting to your computer…', '', true);

    pc = new RTCPeerConnection({ iceServers: [] });
    stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });

    pc.onicecandidate = function (e) {
      if (!e.candidate) return;
      api('/api/ice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'phone', candidate: e.candidate.toJSON() })
      }).catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') {
        setStatus('Live — you are on camera', 'live', false);
        if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {});
      } else if (pc.connectionState === 'failed') {
        setStatus('Connection lost — reload this page', 'err', false);
      } else if (pc.connectionState === 'disconnected' && !stopped) {
        setStatus('Reconnecting…', '', true);
      }
    };

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    var res = await api('/api/offer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type })
    });
    if (!res.ok) { setStatus('This link has expired — scan the code again', 'err', false); return; }

    pollForAnswer();
  }

  function pollForAnswer() {
    clearInterval(polling);
    polling = setInterval(async function () {
      if (stopped || !pc) return;
      try {
        var res = await api('/api/answer');
        if (!res.ok) return;
        var data = await res.json();
        if (data.answer && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(data.answer);
        }
        if (data.candidates && data.candidates.length && pc.remoteDescription) {
          for (var i = 0; i < data.candidates.length; i++) {
            try { await pc.addIceCandidate(data.candidates[i]); } catch (e) {}
          }
        }
      } catch (e) { /* desktop went away; keep trying */ }
    }, 700);
  }

  function teardown() {
    stopped = true;
    clearInterval(polling);
    if (pc) { pc.close(); pc = null; }
    stopStream();
    video.srcObject = null;
  }

  flipBtn.onclick = function () {
    if (cameras.length < 2) return;
    switchTo((cameraIndex + 1) % cameras.length);
  };
  picker.onchange = function () {
    var index = Number(picker.value);
    if (index !== cameraIndex) switchTo(index);
  };
  document.getElementById('stop').onclick = function () {
    teardown();
    api('/api/bye', { method: 'POST' }).catch(function () {});
    setStatus('Disconnected — reload to reconnect', '', false);
  };
  // A camera being plugged in or removed changes the list under us.
  if (navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      refreshCameras().catch(function () {});
    });
  }

  start();
})();
</script>
</body>
</html>`;
}
