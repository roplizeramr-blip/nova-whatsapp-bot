import { WebSocketServer } from 'ws';
import { GeminiLiveSession } from './gemini-live.js';
import resampler from './audio-resampler.js';

export const CALL_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>مكالمة صوتية حية مع أسترو ⚡ Gemini 3.8 Live</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #070b10;
    --card: rgba(14, 23, 33, 0.85);
    --border: rgba(0, 255, 163, 0.25);
    --neon: #00ffa3;
    --cyan: #00d4ff;
    --purple: #a855f7;
    --red: #ff3366;
    --text: #e6edf3;
    --muted: #8b949e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: radial-gradient(circle at 50% 30%, #101e30 0%, var(--bg) 80%);
    color: var(--text);
    font-family: 'Cairo', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 20px;
    overflow: hidden;
  }
  .call-card {
    background: var(--card);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 32px;
    width: 100%;
    max-width: 440px;
    padding: 36px 24px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 255, 163, 0.1);
    position: relative;
    overflow: hidden;
  }
  .model-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 20px;
    background: rgba(0, 212, 255, 0.12);
    border: 1px solid rgba(0, 212, 255, 0.3);
    color: var(--cyan);
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 24px;
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--neon);
    box-shadow: 0 0 10px var(--neon);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.6; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.6; }
  }
  .avatar-container {
    position: relative;
    width: 140px;
    height: 140px;
    margin: 0 auto 20px;
  }
  .avatar-ring {
    position: absolute;
    inset: -10px;
    border-radius: 50%;
    border: 2px dashed rgba(0, 255, 163, 0.4);
    animation: spin 20s linear infinite;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }
  .avatar {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: linear-gradient(135deg, #0f2b38, #16384c);
    border: 3px solid var(--neon);
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 58px;
    box-shadow: 0 0 30px rgba(0, 255, 163, 0.25);
    transition: transform 0.3s;
  }
  .speaking .avatar {
    transform: scale(1.08);
    box-shadow: 0 0 50px rgba(0, 255, 163, 0.6);
  }
  h2 {
    font-size: 26px;
    font-weight: 900;
    color: #fff;
    margin-bottom: 6px;
  }
  .status-text {
    font-size: 15px;
    color: var(--muted);
    margin-bottom: 18px;
    min-height: 24px;
  }
  .call-timer {
    font-size: 22px;
    font-weight: 700;
    color: var(--neon);
    margin-bottom: 24px;
    letter-spacing: 2px;
    display: none;
  }
  .visualizer-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 4px;
    height: 36px;
    margin-bottom: 28px;
  }
  .bar {
    width: 4px;
    height: 6px;
    background: var(--cyan);
    border-radius: 4px;
    transition: height 0.1s ease;
  }
  .controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
  }
  .btn-call {
    background: linear-gradient(135deg, var(--neon), var(--cyan));
    color: #051016;
    border: none;
    padding: 16px 36px;
    border-radius: 50px;
    font-size: 18px;
    font-weight: 900;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 8px 25px rgba(0, 255, 163, 0.35);
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .btn-call:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 35px rgba(0, 255, 163, 0.5);
  }
  .btn-end {
    background: linear-gradient(135deg, #ff3366, #ff5e62);
    color: #fff;
    border: none;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    font-size: 24px;
    cursor: pointer;
    display: none;
    justify-content: center;
    align-items: center;
    box-shadow: 0 8px 25px rgba(255, 51, 102, 0.4);
    transition: all 0.2s;
  }
  .btn-end:hover {
    transform: scale(1.08);
  }
  .btn-action {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #fff;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
    display: none;
    justify-content: center;
    align-items: center;
    transition: all 0.2s;
  }
  .btn-action.active {
    background: rgba(255, 51, 102, 0.2);
    border-color: var(--red);
    color: var(--red);
  }
</style>
</head>
<body>

<div class="call-card" id="callCard">
  <div class="model-tag">
    <div class="pulse-dot"></div>
    Gemini 3.8 Live Extended Thinking
  </div>

  <div class="avatar-container">
    <div class="avatar-ring"></div>
    <div class="avatar">⚡</div>
  </div>

  <h2>أسترو (Astro)</h2>
  <div class="status-text" id="statusText">مستعد للمكالمة.. اضغط للبدء</div>
  <div class="call-timer" id="callTimer">00:00</div>

  <div class="visualizer-container" id="visualizer">
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    <div class="bar"></div><div class="bar"></div><div class="bar"></div>
  </div>

  <div class="controls">
    <button class="btn-action" id="muteBtn" onclick="toggleMute()" title="كتم الصوت">🎙️</button>
    <button class="btn-call" id="startBtn" onclick="startCall()">📞 بدء المكالمة</button>
    <button class="btn-end" id="endBtn" onclick="endCall()" title="إنهاء المكالمة">📴</button>
  </div>
</div>

<script>
let ws = null;
let audioCtx = null;
let micStream = null;
let processor = null;
let timerInterval = null;
let secondsElapsed = 0;
let isMuted = false;
let isCallActive = false;
let audioQueue = [];
let isPlaying = false;

const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const muteBtn = document.getElementById('muteBtn');
const timerEl = document.getElementById('callTimer');
const cardEl = document.getElementById('callCard');
const bars = document.querySelectorAll('.bar');

async function startCall() {
  try {
    statusText.textContent = 'جاري الاتصال بالسيرفر والميكروفون...';
    startBtn.style.display = 'none';

    // 1. طلب صلاحية المايكروفون
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // 2. إعداد Web Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // 3. الاتصال بـ WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + window.location.host + '/ws/live-call');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      statusText.textContent = '🟢 متصل حياً مع أسترو! تحدث الآن...';
      isCallActive = true;
      endBtn.style.display = 'flex';
      muteBtn.style.display = 'flex';
      timerEl.style.display = 'block';
      startTimer();
      setupMicProcessor();
    };

    ws.onmessage = async (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        // صوت 24kHz PCM قادم من Gemini Live
        playPcmChunk(new Int16Array(evt.data));
        animateVisualizer(true);
      } else {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.event === 'interrupted') {
            audioQueue = [];
          }
        } catch (_) {}
      }
    };

    ws.onerror = (e) => {
      statusText.textContent = '❌ خطأ في الاتصال';
      endCall();
    };

    ws.onclose = () => {
      endCall();
    };

  } catch (err) {
    statusText.textContent = '❌ تعذر فتح المايك: ' + err.message;
    startBtn.style.display = 'inline-flex';
  }
}

function setupMicProcessor() {
  const source = audioCtx.createMediaStreamSource(micStream);
  // ScriptProcessor لتحويل الصوت إلى 16kHz Int16
  processor = audioCtx.createScriptProcessor(2048, 1, 1);

  processor.onaudioprocess = (e) => {
    if (!isCallActive || isMuted || ws?.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    // تحويل Float32 إلى Int16
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    ws.send(pcm16.buffer);
    animateVisualizer(false);
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
}

function playPcmChunk(int16Array) {
  if (!audioCtx) return;
  const float32 = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32[i] = int16Array[i] / 32768.0;
  }

  const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  source.start();

  cardEl.classList.add('speaking');
  source.onended = () => {
    cardEl.classList.remove('speaking');
  };
}

function animateVisualizer(fromAI) {
  bars.forEach(bar => {
    const height = Math.floor(Math.random() * 28) + 6;
    bar.style.height = height + 'px';
    bar.style.background = fromAI ? 'var(--neon)' : 'var(--cyan)';
  });
}

function toggleMute() {
  isMuted = !isMuted;
  muteBtn.classList.toggle('active', isMuted);
  muteBtn.textContent = isMuted ? '🔇' : '🎙️';
  statusText.textContent = isMuted ? '🔇 المايك مكتوم' : '🟢 متصل حياً مع أسترو';
}

function startTimer() {
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    timerEl.textContent = m + ':' + s;
  }, 1000);
}

function endCall() {
  isCallActive = false;
  clearInterval(timerInterval);
  if (ws) { try { ws.close(); } catch(_) {} ws = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (processor) { processor.disconnect(); processor = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }

  cardEl.classList.remove('speaking');
  startBtn.style.display = 'inline-flex';
  endBtn.style.display = 'none';
  muteBtn.style.display = 'none';
  timerEl.style.display = 'none';
  statusText.textContent = '📴 انتهت المكالمة.. اضغط للبدء من جديد';
  bars.forEach(b => b.style.height = '6px');
}
</script>
</body>
</html>`;

/**
 * Initializes WebSocket Server for Live Voice Calling
 */
export function initLiveCallWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/ws/live-call') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws) => {
    console.log('🎙️ [LIVE-CALL] اتصال متصفح جديد بالمكالمة الصوتية');
    let liveSession = null;

    try {
      liveSession = new GeminiLiveSession();

      // إرسال صوت Gemini 24kHz للعميل
      liveSession.on('audio24k', (rawChunk) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(rawChunk);
        }
      });

      liveSession.on('interrupted', () => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ event: 'interrupted' }));
        }
      });

      await liveSession.connect();

      // استقبال صوت المايكروفون (16kHz PCM) من المتصفح وتمريره إلى Gemini Live
      ws.on('message', (data) => {
        if (Buffer.isBuffer(data) && liveSession && liveSession.ready) {
          liveSession.sendAudio(data);
        }
      });

    } catch (err) {
      console.error('❌ [LIVE-CALL] فشل جلسة المكالمة الحية:', err.message);
      if (ws.readyState === ws.OPEN) ws.close();
    }

    ws.on('close', () => {
      console.log('📴 [LIVE-CALL] تم قطع اتصال المتصفح بالمكالمة');
      if (liveSession) {
        liveSession.close();
        liveSession = null;
      }
    });
  });

  return wss;
}

export default {
  CALL_PAGE,
  initLiveCallWs
};
