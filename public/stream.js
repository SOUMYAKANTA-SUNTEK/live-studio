// Desktop app features: webcam, microphone, combining everything into one
// picture and going live. Does nothing when the page is opened in a normal browser.

(() => {
  if (!window.studio) return;
  document.body.classList.add('is-app');
  document.querySelector('[data-tab="stream"]').click(); // open on the Stream tab

  const $ = (id) => document.getElementById(id);
  const camVideo = $('camPreview');
  const camLayer = $('camLayer');
  const logEl = $('streamLog');
  const liveInfo = $('liveInfo');
  const liveButtons = document.querySelectorAll('[data-stream="toggle"]');

  const DEFAULTS = {
    serverUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: '',
    quality: '1080-30',
    bitrate: 6000,
    encoder: '',
    camId: '',
    micId: '',
    micGain: 1,
    micMute: false,
    noiseSup: false,
  };
  const MIME_TYPES = [
    'video/x-matroska;codecs=avc1,opus',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const MAX_RETRIES = 5;
  const PASSTHROUGH_MIME = 'video/x-matroska;codecs=avc1,opus';

  let settings = { ...DEFAULTS };
  let camStream = null;
  let micStream = null;
  let micSource = null;
  // The overlay is kept on its own canvas and patched with just the changed areas
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = CANVAS_W;
  overlayCanvas.height = CANVAS_H;
  const overlayCtx = overlayCanvas.getContext('2d');
  let overlayChain = Promise.resolve();

  // Live session
  let live = false;
  let userStopped = false;
  let retries = 0;
  let recorder = null;
  let drawTimer = null;
  let finalView = false;
  let startedAt = 0;
  let generation = 0; // bumps on every (re)connect so stale chunks are dropped

  // ---------- Audio graph: mic → volume → (meter, stream) ----------

  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const gainNode = audioCtx.createGain();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  const audioDest = audioCtx.createMediaStreamDestination();
  gainNode.connect(analyser);
  gainNode.connect(audioDest);
  // A silent source keeps the audio track alive even with no microphone,
  // because YouTube expects an audio track.
  const silence = audioCtx.createConstantSource();
  const silenceGain = audioCtx.createGain();
  silenceGain.gain.value = 0;
  silence.connect(silenceGain).connect(audioDest);
  silence.start();

  function applyGain() {
    gainNode.gain.value = settings.micMute ? 0 : Number(settings.micGain);
  }

  const meterSamples = new Float32Array(analyser.fftSize);
  (function meter() {
    analyser.getFloatTimeDomainData(meterSamples);
    let peak = 0;
    for (const v of meterSamples) peak = Math.max(peak, Math.abs(v));
    const db = 20 * Math.log10(peak || 1e-6);
    $('micMeter').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    setTimeout(meter, 66); // ~15 updates a second is plenty for a level bar
  })();

  // ---------- Devices ----------

  async function listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (select, kind, current) => {
      const list = devices.filter((d) => d.kind === kind);
      select.innerHTML = list.map((d, i) =>
        `<option value="${esc(d.deviceId)}">${esc(d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`)}</option>`,
      ).join('') + '<option value="none">None</option>';
      // Without a saved choice, prefer a real camera over virtual ones
      // (e.g. "OBS Virtual Camera" shows black unless OBS is running)
      const real = list.find((d) => !/virtual|obs|snap camera|manycam|droidcam/i.test(d.label)) || list[0];
      select.value = list.some((d) => d.deviceId === current) || current === 'none' ? current : (real?.deviceId || 'none');
    };
    fill($('camSelect'), 'videoinput', settings.camId);
    fill($('micSelect'), 'audioinput', settings.micId);
  }

  // The output picture is drawn from its own video element. It is kept
  // rendered (tiny and invisible) rather than hidden, because Chromium can
  // stop updating a video inside a hidden container, such as the preview
  // while Final view is open, which would leave the webcam black on stream.
  const compVideo = document.createElement('video');
  compVideo.muted = true;
  compVideo.playsInline = true;
  Object.assign(compVideo.style, {
    position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none',
  });
  document.body.appendChild(compVideo);

  let camError = '';

  function setCamStatus(kind, text) {
    const el = $('camStatus');
    el.className = `cam-status ${kind}`;
    el.textContent = text;
    if (kind === 'error') {
      const retry = document.createElement('button');
      retry.textContent = 'Try the webcam again';
      retry.addEventListener('click', async () => {
        await listDevices();
        startCamera();
      });
      el.appendChild(retry);
    }
  }

  // Plain-language reasons for the usual webcam failures on Windows
  function cameraProblem(err) {
    switch (err && err.name) {
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return 'Another app is using the webcam. Close Zoom, Teams, the Windows Camera app, OBS or any browser tab that uses the camera, then try again.';
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Windows is blocking the camera. Open Settings → Privacy & security → Camera, turn on "Camera access" and "Let desktop apps access your camera", then try again.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No webcam was found. Check it is plugged in, pick it in the list above, then try again.';
      default:
        return `The webcam could not start (${(err && (err.message || err.name)) || 'unknown error'}).`;
    }
  }

  async function startCamera() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    camVideo.srcObject = null;
    compVideo.srcObject = null;
    camError = '';
    const id = $('camSelect').value || settings.camId;
    if (id === 'none' && $('camSelect').options.length <= 1) {
      camError = 'No webcam was found. Check it is plugged in and that Windows allows camera access (Settings → Privacy & security → Camera), then try again.';
      setCamStatus('error', camError);
    } else if (id === 'none') {
      setCamStatus('', 'No webcam selected.');
    } else {
      setCamStatus('', 'Starting the webcam…');
      // Capture only as much as the stream needs (less decoding work)
      const { height: h, fps: f } = quality();
      const video = { width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate: { ideal: f } };
      let lastErr = null;
      try {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: id ? { ...video, deviceId: { exact: id } } : video,
        });
      } catch (err) {
        lastErr = err;
        try {
          camStream = await navigator.mediaDevices.getUserMedia({ video });
        } catch (err2) {
          lastErr = err2;
        }
      }
      if (camStream) {
        camVideo.srcObject = camStream;
        compVideo.srcObject = camStream;
        camVideo.play().catch(() => {});
        compVideo.play().catch(() => {});
        const track = camStream.getVideoTracks()[0];
        const s = track.getSettings();
        setCamStatus('ok', `✓ Webcam on: ${track.label || 'camera'}${s.width ? ` (${s.width}×${s.height})` : ''}`);
        // Unplugged, or taken over by another app
        track.addEventListener('ended', () => {
          camError = 'The webcam stopped. It may have been unplugged or taken by another app.';
          setCamStatus('error', camError);
        });
      } else {
        camError = cameraProblem(lastErr);
        setCamStatus('error', camError);
      }
    }
    window.afterLayout();
  }

  // Keep the compositing video playing (Windows can pause it, e.g. after sleep)
  setInterval(() => {
    if (compVideo.srcObject && compVideo.paused) compVideo.play().catch(() => {});
  }, 1000);

  async function startMic() {
    if (micSource) micSource.disconnect();
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micSource = null;
    micStream = null;
    const id = $('micSelect').value || settings.micId;
    if (id === 'none') return;
    const audio = {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: !!settings.noiseSup,
      channelCount: 2,
      sampleRate: 48000,
    };
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: id ? { ...audio, deviceId: { exact: id } } : audio,
      });
    } catch {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (err) {
        showLog(`Could not open the microphone: ${err.message}`, true);
        return;
      }
    }
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(gainNode);
    audioCtx.resume();
  }

  navigator.mediaDevices.addEventListener('devicechange', listDevices);

  // ---------- Webcam in the preview ----------

  function camSettings() {
    return { fit: 'cover', mirror: false, zoom: 1, ...state.elements.camera };
  }

  window.afterLayout = () => {
    if (!state) return;
    const cam = camSettings();
    const show = !!camStream && cam.visible !== false;
    camLayer.style.display = show ? 'block' : 'none';
    stage.classList.toggle('has-cam', !!camStream);
    Object.assign(camLayer.style, {
      left: `${cam.x}px`, top: `${cam.y}px`, width: `${cam.w}px`, height: `${cam.h}px`,
    });
    camVideo.style.objectFit = cam.fit;
    camVideo.style.transform = `scale(${cam.mirror ? -cam.zoom : cam.zoom}, ${cam.zoom})`;
  };

  // ---------- Overlay frames from the off-screen renderer ----------

  studio.onOverlayFrame((f) => {
    // Patches must be applied in order, so they are chained
    overlayChain = overlayChain.then(async () => {
      const bitmap = await createImageBitmap(new Blob([f.png], { type: 'image/png' }));
      if (overlayCanvas.width !== f.fullWidth || overlayCanvas.height !== f.fullHeight) {
        overlayCanvas.width = f.fullWidth;
        overlayCanvas.height = f.fullHeight;
      }
      overlayCtx.clearRect(f.x, f.y, f.width, f.height);
      overlayCtx.drawImage(bitmap, f.x, f.y);
      bitmap.close();
    }).catch(() => {});
  });

  // ---------- Combining webcam + overlay into the output picture ----------

  const out = document.createElement('canvas');
  out.width = CANVAS_W;
  out.height = CANVAS_H;
  const ctx = out.getContext('2d', { alpha: false });
  out.className = 'final-canvas';
  $('previewWrap').appendChild(out);

  // The output canvas is the stream's real size (e.g. 1280x720 for 720p);
  // drawing is done in 1920x1080 units and scaled.
  function sizeOutput(height) {
    const w = Math.round((height * 16) / 9);
    if (out.width !== w || out.height !== height) {
      out.width = w;
      out.height = height;
    }
  }

  function drawFrame() {
    ctx.setTransform(out.width / CANVAS_W, 0, 0, out.height / CANVAS_H, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const cam = camSettings();
    if (camStream && cam.visible !== false && compVideo.videoWidth) {
      const vw = compVideo.videoWidth;
      const vh = compVideo.videoHeight;
      const fit = cam.fit === 'contain' ? Math.min : Math.max;
      const k = fit(cam.w / vw, cam.h / vh) * (cam.zoom || 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cam.x, cam.y, cam.w, cam.h);
      ctx.clip();
      ctx.translate(cam.x + cam.w / 2, cam.y + cam.h / 2);
      if (cam.mirror) ctx.scale(-1, 1);
      ctx.drawImage(compVideo, (-vw * k) / 2, (-vh * k) / 2, vw * k, vh * k);
      ctx.restore();
    }
    ctx.drawImage(overlayCanvas, 0, 0, CANVAS_W, CANVAS_H);
    drawTickerText(ctx, state, serverOffset);
  }

  // ---------- Going live ----------

  function quality() {
    const [height, fps] = settings.quality.split('-').map(Number);
    return { height, fps };
  }

  function showLog(text, isError = false) {
    logEl.textContent = text;
    logEl.classList.toggle('error', isError);
  }

  function setLiveUi(state, info = '') {
    for (const b of liveButtons) {
      b.disabled = state === 'starting';
      b.classList.toggle('live', state === 'live');
      b.textContent = { idle: 'Go Live', starting: 'Connecting…', live: 'End stream' }[state];
    }
    liveInfo.textContent = info;
  }

  async function startPipeline() {
    const { height, fps } = quality();
    const kbps = Number(settings.bitrate) || 6000;
    let encoder = settings.encoder || 'libx264';
    if (encoder === 'passthrough' && !MediaRecorder.isTypeSupported(PASSTHROUGH_MIME)) encoder = 'libx264';
    const mimeType = encoder === 'passthrough' ? PASSTHROUGH_MIME : MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    sizeOutput(height);
    await studio.startStream({ url: settings.serverUrl.trim(), key: settings.streamKey.trim(), encoder, kbps, fps, height });
    const tracks = [...out.captureStream(fps).getVideoTracks(), ...audioDest.stream.getAudioTracks()];
    recorder = new MediaRecorder(new MediaStream(tracks), encoder === 'passthrough'
      ? {
        // This is the final encode: real bitrate, keyframe every 2 s for YouTube.
        // Chromium uses the graphics card's H.264 encoder when it can.
        mimeType,
        videoBitsPerSecond: kbps * 1000,
        videoKeyFrameIntervalDuration: 2000,
        audioBitsPerSecond: 160_000,
      }
      : {
        mimeType,
        videoBitsPerSecond: kbps * 2500, // local hand-off only; FFmpeg sets the real bitrate
        audioBitsPerSecond: 256_000,
      });
    // Keep the chunks in order while they are converted
    const gen = ++generation;
    let chain = Promise.resolve();
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chain = chain.then(() => e.data.arrayBuffer()).then((buf) => gen === generation && studio.sendChunk(buf));
    };
    recorder.start(250);
    updateDrawLoop();
  }

  function stopPipeline() {
    generation++;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    updateDrawLoop();
  }

  // The output picture is drawn while live and while the final view is open.
  let loopFps = 0;
  function updateDrawLoop() {
    const wanted = recorder ? quality().fps : finalView || document.fullscreenElement === out ? 30 : 0;
    if (wanted === loopFps) return;
    clearInterval(drawTimer);
    drawTimer = null;
    loopFps = wanted;
    if (wanted) {
      drawFrame();
      drawTimer = setInterval(drawFrame, 1000 / wanted);
    }
  }

  // ---------- Edit layout / Final view ----------

  function setView(final) {
    finalView = final;
    $('previewWrap').classList.toggle('final', final);
    for (const b of document.querySelectorAll('[data-view]')) {
      b.classList.toggle('active', (b.dataset.view === 'final') === final);
    }
    updateDrawLoop();
  }

  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view === 'final'));
  }

  function fullScreenPreview() {
    if (document.fullscreenElement) return document.exitFullscreen();
    out.requestFullscreen().then(updateDrawLoop);
  }
  $('fullPreview').addEventListener('click', fullScreenPreview);
  document.addEventListener('fullscreenchange', updateDrawLoop);

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'v') setView(!finalView);
    if (e.key.toLowerCase() === 'f') fullScreenPreview();
  });

  async function goLive() {
    if (!settings.streamKey.trim()) {
      document.querySelector('[data-tab="stream"]').click();
      $('streamKey').focus();
      showLog('Paste your YouTube stream key first.', true);
      return;
    }
    const cam = camSettings();
    if (cam.visible !== false && (!camStream || camError)) {
      document.querySelector('[data-tab="stream"]').click();
      const reason = camError || 'No webcam is selected.';
      if (!confirm(`Your webcam is not working, so viewers will see a black box.\n\n${reason}\n\nGo live anyway?`)) return;
    }
    await audioCtx.resume();
    live = true;
    userStopped = false;
    retries = 0;
    startedAt = Date.now();
    showLog('');
    setLiveUi('starting');
    await startPipeline();
  }

  async function endLive() {
    userStopped = true;
    live = false;
    stopPipeline();
    await studio.stopStream();
    setLiveUi('idle');
    showLog('Stream ended.');
  }

  studio.onStatus((s) => {
    if (s.type === 'stats' && live) {
      if (s.seconds > 10) retries = 0; // connection has been stable
      const slow = s.speed && s.speed < 0.95;
      setLiveUi('live', `${s.time.split('.')[0]} · ${Math.round(s.kbps)} kbps${s.fps ? ` · ${Math.round(s.fps)} fps` : ''}${slow ? ' · ⚠ falling behind' : ''}`);
      if (slow) showLog('Your PC or upload is not keeping up. Try a lower quality, a lower bitrate or a graphics-card encoder.', true);
      else if (logEl.classList.contains('error') && logEl.textContent.startsWith('Your PC')) showLog('');
    }
    if (s.type === 'ended') {
      if (!live || userStopped) return;
      stopPipeline();
      const log = (s.log || []).slice(-6).join('\n');
      const quick = Date.now() - startedAt < 8000;
      if (quick && retries === 0) {
        // Failed straight away: usually a wrong key or no internet
        live = false;
        setLiveUi('idle');
        showLog(`Could not connect to YouTube. Check the stream key and your internet connection.\n\n${log}`, true);
        return;
      }
      if (retries < MAX_RETRIES) {
        retries++;
        setLiveUi('starting', `Reconnecting (${retries}/${MAX_RETRIES})…`);
        showLog(`Connection lost. Reconnecting…\n\n${log}`, true);
        setTimeout(() => live && !userStopped && startPipeline(), 3000);
      } else {
        live = false;
        setLiveUi('idle');
        showLog(`The stream stopped and could not reconnect.\n\n${log}`, true);
      }
    }
  });

  for (const b of liveButtons) {
    b.addEventListener('click', () => (live ? confirm('End the live stream?') && endLive() : goLive()));
  }

  // ---------- Settings ----------

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => studio.saveSettings(settings), 300);
  }

  function readForm() {
    settings.serverUrl = $('serverUrl').value;
    settings.streamKey = $('streamKey').value;
    settings.quality = $('quality').value;
    settings.bitrate = Number($('bitrate').value) || DEFAULTS.bitrate;
    settings.encoder = $('encoder').value;
    settings.micGain = Number($('micGain').value);
    settings.micMute = $('micMute').checked;
    settings.noiseSup = $('noiseSup').checked;
    settings.camId = $('camSelect').value;
    settings.micId = $('micSelect').value;
  }

  function writeForm() {
    $('serverUrl').value = settings.serverUrl;
    $('streamKey').value = settings.streamKey;
    $('quality').value = settings.quality;
    $('bitrate').value = settings.bitrate;
    $('micGain').value = settings.micGain;
    $('micMute').checked = settings.micMute;
    $('noiseSup').checked = settings.noiseSup;
  }

  const SUGGESTED_BITRATE = { '1080-30': 6000, '1080-60': 9000, '720-30': 4000, '720-60': 6000 };

  document.querySelector('[data-panel="stream"]').addEventListener('input', (e) => {
    if (e.target.matches('[data-bind]')) return; // camera layout lives in the shared state
    const before = settings.quality;
    readForm();
    if (e.target.id === 'quality' && settings.quality !== before) {
      settings.bitrate = SUGGESTED_BITRATE[settings.quality];
      $('bitrate').value = settings.bitrate;
    }
    if (e.target.id === 'camSelect' || (e.target.id === 'quality' && !live)) startCamera();
    if (e.target.id === 'micSelect' || e.target.id === 'noiseSup') startMic();
    applyGain();
    saveSettings();
  });

  $('showKey').addEventListener('click', () => {
    const input = $('streamKey');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('showKey').textContent = input.type === 'password' ? 'Show' : 'Hide';
  });

  // ---------- Start up ----------

  (async () => {
    settings = { ...DEFAULTS, ...(await studio.getSettings()) };
    writeForm();
    applyGain();
    setLiveUi('idle');
    // Ask for camera and mic once so device names are available
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* no camera or mic, or permission denied; the lists will say so */
    }
    await listDevices();
    await Promise.all([startCamera(), startMic()]);

    const encoders = await studio.encoders();
    if (MediaRecorder.isTypeSupported(PASSTHROUGH_MIME)) {
      encoders.unshift({ id: 'passthrough', label: 'Light mode: least CPU and heat (recommended)' });
    }
    const select = $('encoder');
    select.innerHTML = encoders.map((e) => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join('');
    // Move everyone to Light mode once, since it is much easier on the PC
    if (!settings.lightModeOffered) {
      settings.lightModeOffered = true;
      settings.encoder = encoders[0]?.id;
      saveSettings();
    }
    if (!encoders.some((e) => e.id === settings.encoder)) settings.encoder = encoders[0]?.id || 'libx264';
    select.value = settings.encoder;
  })();
})();
