// Runs FFmpeg: takes the WebM/MKV stream recorded in the app window on stdin,
// encodes it to H.264 + AAC and pushes it to YouTube over RTMP.

const { spawn } = require('child_process');

const fs = require('fs');
const path = require('path');

function findFfmpeg() {
  // Updates can be dropped into resources/app as plain files, which Electron
  // prefers over app.asar; the binary then still lives in app.asar.unpacked.
  const unpacked = process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {
    // Inside the packaged app the binary is unpacked next to the asar archive
    const p = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(p)) return p;
  } catch {}
  return unpacked;
}

let ffmpegPath = findFfmpeg();

// Encoders in order of preference: NVIDIA, Intel, AMD, then the CPU
const ENCODERS = [
  { id: 'h264_nvenc', label: 'NVIDIA graphics card (NVENC)' },
  { id: 'h264_qsv', label: 'Intel graphics (Quick Sync)' },
  { id: 'h264_amf', label: 'AMD graphics card (AMF)' },
  { id: 'libx264', label: 'CPU (x264)' },
];

let available = null;

function tryEncoder(id) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=black:s=640x360:d=0.2',
      '-c:v', id, '-f', 'null', '-',
    ], { windowsHide: true });
    const timer = setTimeout(() => proc.kill(), 10000);
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

// Try a tiny encode with each encoder to see which ones work on this PC.
async function detectEncoders() {
  if (!available) {
    const results = await Promise.all(ENCODERS.map((e) => tryEncoder(e.id)));
    available = ENCODERS.filter((_, i) => results[i]);
  }
  return available;
}

function videoArgs(encoder, kbps, fps) {
  const gop = String(fps * 2); // keyframe every 2 seconds, as YouTube recommends
  const rate = ['-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-g', gop];
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'cbr', ...rate, '-bf', '2'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', ...rate];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cbr', ...rate];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', ...rate, '-x264-params', 'nal-hrd=cbr'];
  }
}

class Streamer {
  constructor(onStatus) {
    this.proc = null;
    this.onStatus = onStatus;
    this.stopping = false;
  }

  start({ url, key, encoder, kbps, fps, height }) {
    this.stop();
    this.stopping = false;
    const target = `${url.replace(/\/+$/, '')}/${key}`;
    // 'passthrough': the app window already made H.264 at the right size and
    // bitrate, so FFmpeg only repackages it. One encode instead of two.
    const video = encoder === 'passthrough'
      ? ['-c:v', 'copy']
      : [
        '-fps_mode', 'cfr', '-r', String(fps), '-pix_fmt', 'yuv420p',
        ...videoArgs(encoder, kbps, fps),
      ];
    const args = [
      '-hide_banner', '-loglevel', 'info', '-stats_period', '1',
      '-fflags', '+genpts', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?',
      ...video,
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-f', 'flv', target,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    this.proc = proc;
    const tail = [];

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => {
      for (const line of text.split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        // Progress lines differ by mode (no frame/fps when the video is only
        // repackaged), so each field is optional
        const time = line.match(/time=\s*(\d+):(\d+):([\d.]+)/);
        if (time && /bitrate=/.test(line)) {
          const field = (name) => {
            const f = line.match(new RegExp(`${name}=\\s*([\\d.]+)`));
            return f ? parseFloat(f[1]) : 0;
          };
          this.onStatus({
            type: 'stats',
            time: `${time[1]}:${time[2]}:${time[3]}`,
            seconds: +time[1] * 3600 + +time[2] * 60 + parseFloat(time[3]),
            fps: field('fps'),
            kbps: field('bitrate'),
            speed: field('speed'),
          });
        } else {
          tail.push(line.replace(key, '<stream key>'));
          if (tail.length > 12) tail.shift();
        }
      }
    });
    proc.stdin.on('error', () => {}); // ignore writes after FFmpeg exits
    proc.on('error', (err) => this.onStatus({ type: 'ended', expected: false, log: [String(err)] }));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.onStatus({ type: 'ended', expected: this.stopping, code, log: tail });
    });
    this.onStatus({ type: 'started' });
  }

  write(chunk) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(Buffer.from(chunk));
  }

  stop() {
    if (!this.proc) return;
    this.stopping = true;
    const proc = this.proc;
    proc.stdin.end();
    // Give FFmpeg a moment to flush, then make sure it is gone
    setTimeout(() => proc.exitCode === null && proc.kill(), 3000);
  }
}

module.exports = { Streamer, detectEncoders, ffmpegPath };
