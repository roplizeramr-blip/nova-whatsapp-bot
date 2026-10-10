import http from 'node:http';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullSnapshot } from './stats.js';
import { db } from './db.js';
import { config } from '../config.js';
import {
  isDbConnected,
  isDbConfigured,
  getDbStats,
  exportSessionDump,
  importSessionDump,
} from './postgres.js';
import { chatWithAI } from './ai.js';
import { CALL_PAGE, initLiveCallWs } from './live-call-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, '..', 'session');
export const QR_FILE = join(
  __dirname,
  '..',
  process.env.RAILWAY_ENVIRONMENT ? 'session' : 'data',
  'qr.txt',
);

function readQr() {
  try {
    return fs.readFileSync(QR_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function asciiQr(text) {
  let out = '';
  qrcodeTerminal.generate(text, { small: true }, (s) => { out = s; });
  return out;
}

// 🚀 NOVA / ASTRO MASTER DASHBOARD — Cyberpunk Glassmorphism UI
const PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ASTRO AI ⚡ — لوحة القيادة المتطورة</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #070b10;
    --card: rgba(14, 23, 33, 0.75);
    --border: rgba(0, 255, 163, 0.18);
    --neon: #00ffa3;
    --cyan: #00d4ff;
    --purple: #a855f7;
    --red: #ff3366;
    --yellow: #ffb800;
    --text: #e6edf3;
    --muted: #8b949e;
  }
  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    background: radial-gradient(circle at 50% 0%, #101c29 0%, var(--bg) 70%);
    color: var(--text);
    font-family: 'Cairo', system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    padding: 20px 14px 40px;
    line-height: 1.6;
  }
  .container { max-width: 1140px; margin: 0 auto; }
  
  /* Navbar */
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--card);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 14px 22px;
    margin-bottom: 22px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand h1 { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; background: linear-gradient(135deg, var(--neon), var(--cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 30px; font-size: 12px; font-weight: 700; }
  .badge-live { background: rgba(0,255,163,0.12); color: var(--neon); border: 1px solid rgba(0,255,163,0.3); }
  .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--neon); box-shadow: 0 0 10px var(--neon); animation: pulse 1.8s infinite; }
  @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } 100% { opacity: 1; transform: scale(1); } }
  
  /* Grid KPIs */
  .grid-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .kpi-card {
    background: var(--card);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    padding: 18px 16px;
    text-align: center;
    transition: transform 0.2s, border-color 0.2s;
  }
  .kpi-card:hover { transform: translateY(-3px); border-color: var(--neon); }
  .kpi-num { font-size: 28px; font-weight: 900; color: #fff; margin-bottom: 2px; }
  .kpi-lbl { color: var(--muted); font-size: 13px; font-weight: 600; }
  
  /* Sections Grid */
  .grid-sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 18px;
    margin-bottom: 22px;
  }
  .panel {
    background: var(--card);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }
  .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .panel-title { font-size: 16px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px; }
  
  /* DB Status Box */
  .db-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .db-item { background: rgba(0,0,0,0.25); padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.04); }
  .db-item .label { font-size: 12px; color: var(--muted); }
  .db-item .val { font-size: 16px; font-weight: 700; color: var(--cyan); }
  
  /* QR Code Section */
  #qrbox { text-align: center; }
  #qrbox img { background: #fff; border-radius: 14px; padding: 10px; margin: 12px auto; display: block; max-width: 240px; box-shadow: 0 0 25px rgba(0,255,163,0.2); }
  
  /* AI Playground */
  .chat-box { height: 260px; overflow-y: auto; background: rgba(0,0,0,0.35); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(255,255,255,0.04); }
  .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 14px; }
  .msg-user { align-self: flex-start; background: rgba(0,212,255,0.15); border: 1px solid rgba(0,212,255,0.3); color: #fff; border-bottom-right-radius: 2px; }
  .msg-bot { align-self: flex-end; background: rgba(0,255,163,0.12); border: 1px solid rgba(0,255,163,0.3); color: #fff; border-bottom-left-radius: 2px; }
  .msg-meta { font-size: 11px; opacity: 0.6; margin-top: 2px; }
  .chat-input-row { display: flex; gap: 8px; margin-top: 10px; }
  .chat-input { flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 10px 14px; color: #fff; font-family: inherit; font-size: 14px; outline: none; }
  .chat-input:focus { border-color: var(--neon); }
  .chat-btn { background: linear-gradient(135deg, var(--neon), #00b875); color: #070b10; border: none; border-radius: 10px; padding: 0 18px; font-family: inherit; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
  .chat-btn:hover { opacity: 0.9; }
  .persona-select { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: var(--cyan); padding: 6px 10px; font-family: inherit; font-size: 12px; font-weight: 700; margin-bottom: 8px; outline: none; }
  
  /* Tables & Lists */
  .list-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
  .list-row:last-child { border-bottom: none; }
  .btn-action { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text); padding: 7px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; text-decoration: none; transition: 0.2s; cursor: pointer; }
  .btn-action:hover { background: rgba(0,255,163,0.15); border-color: var(--neon); color: var(--neon); }
</style>
</head>
<body>
<div class="container">

  <!-- Navbar -->
  <div class="nav">
    <div class="brand">
      <div class="pulse-dot"></div>
      <h1>ASTRO AI ⚡ DASHBOARD</h1>
      <span class="badge badge-live" id="bot-status-badge">🟢 متصل وشغال</span>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <a href="/api/session/export" class="btn-action">💾 تصدير الجلسة</a>
      <button onclick="tick()" class="btn-action">🔄 تحديث</button>
    </div>
  </div>

  <!-- KPI Cards -->
  <div class="grid-kpi">
    <div class="kpi-card"><div class="kpi-num" id="k-uptime">0</div><div class="kpi-lbl">⏱️ مدة التشغيل</div></div>
    <div class="kpi-card"><div class="kpi-num" id="k-msgs">0</div><div class="kpi-lbl">💬 الرسايل المعالجة</div></div>
    <div class="kpi-card"><div class="kpi-num" id="k-cmds">0</div><div class="kpi-lbl">⚡ الأوامر المنفذة</div></div>
    <div class="kpi-card"><div class="kpi-num" id="k-ai">0</div><div class="kpi-lbl">🧠 ردود الذكاء VEX</div></div>
    <div class="kpi-card"><div class="kpi-num" id="k-users">0</div><div class="kpi-lbl">👥 الأصدقاء بالذاكرة</div></div>
    <div class="kpi-card"><div class="kpi-num" id="k-db-ping">0ms</div><div class="kpi-lbl">🐘 استجابة السحابة</div></div>
  </div>

  <!-- Main Grids -->
  <div class="grid-sections">

    <!-- Cloud PostgreSQL Inspector -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">🐘 قاعدة البيانات السحابية (PostgreSQL)</div>
        <span class="badge" id="db-health-badge" style="background:rgba(0,212,255,0.15);color:var(--cyan)">⚡ سحابية</span>
      </div>
      <p style="font-size:13px;color:var(--muted)">تعتمد نوفا كلياً على قاعدة بيانات <b>nova-db</b> السحابية كمصدر وحيد وموثوق للبيانات بدون فقدان.</p>
      <div class="db-grid">
        <div class="db-item"><div class="label">📦 ملفات الجلسة المحفوظة</div><div class="val" id="db-session-count">0 ملف</div></div>
        <div class="db-item"><div class="label">🔑 سجلات الـ KV (البيانات)</div><div class="val" id="db-kv-count">0 سجل</div></div>
        <div class="db-item"><div class="label">💽 الحجم الإجمالي للسحابة</div><div class="val" id="db-size">N/A</div></div>
        <div class="db-item"><div class="label">⚡ سرعة اتصال PostgreSQL</div><div class="val" id="db-ping">0ms</div></div>
      </div>
      <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:var(--muted)" id="db-conn-str">المضيف: PostgreSQL 16 Cluster</span>
        <button onclick="tick()" class="btn-action">🔍 فحص فوري</button>
      </div>
    </div>

    <!-- WhatsApp & QR Connection -->
    <div class="panel" id="conn-panel">
      <div class="panel-header">
        <div class="panel-title">📲 حالة اتصال واتساب</div>
        <span class="badge" id="wa-status-badge">فحص...</span>
      </div>
      <div id="qrbox" style="display:none;">
        <p style="font-size:13px;color:var(--yellow);margin-bottom:8px;">⚠️ البوت بانتظار ربط الهاتف! امسح الكود التالي عبر واتساب:</p>
        <img id="qr-img" src="/qr.png" alt="كود QR">
        <p style="font-size:12px;color:var(--muted)">افتح واتساب → الأجهزة المرتبطة → ربط جهاز</p>
      </div>
      <div id="wa-connected-box" style="text-align:center;padding:24px 10px;">
        <div style="font-size:44px;margin-bottom:8px;">✅</div>
        <h3 style="color:var(--neon);font-size:18px;margin-bottom:6px;">البوت متصل بنجاح وجاهز للرد!</h3>
        <p style="font-size:13px;color:var(--muted)">الجلسة متزامنة لحظياً مع PostgreSQL. لا حاجة لإعادة مسح الكود عند إعادة التشغيل.</p>
      </div>
    </div>

    <!-- 📞 Live VoIP Voice Calls Panel (Gemini 3.8 Live) -->
    <div class="panel" id="voip-panel" style="grid-column: 1 / -1;">
      <div class="panel-header">
        <div class="panel-title">📞 جهاز مكالمات واتساب الصوتية الحية (Gemini 3.8 Live VoIP)</div>
        <span class="badge" id="voip-status-badge">جاري الفحص...</span>
      </div>
      <div id="voip-qrbox" style="text-align:center;padding:12px 0;">
        <p style="font-size:14px;color:var(--yellow);margin-bottom:8px;font-weight:700;">⚠️ امسح الباركود التالي بكاميرا واتساب لتفعيل الرد الصوتي المباشر على المكالمات:</p>
        <div style="background:#ffffff;border-radius:18px;padding:16px;margin:14px auto;display:inline-block;box-shadow:0 10px 30px rgba(0,0,0,0.4);">
          <img id="voip-qr-img" src="/api/voip/qr.png" alt="باركود مكالمات واتساب" style="width:280px;height:280px;display:block;border-radius:4px;image-rendering:pixelated;">
        </div>
        <p style="font-size:13px;color:var(--text);margin-top:6px;">📲 <b>الخطوات:</b> افتح واتساب ➔ الأجهزة المرتبطة ➔ ربط جهاز ➔ وجّه الكاميرا للباركود</p>
        <p style="font-size:12px;color:var(--neon);margin-top:4px;">🔄 يتجدد الباركود تلقائياً كل ثوانٍ ومستمر بالعمل دون توقف</p>
        <div style="margin-top:10px;">
          <a href="/voip-qr" target="_blank" class="btn-action" style="font-size:13px;padding:8px 16px;">🔍 فتح شاشة الباركود المكبرة المنفصلة</a>
        </div>
      </div>
      <div id="voip-connected-box" style="display:none;text-align:center;padding:26px 10px;">
        <div style="font-size:48px;margin-bottom:10px;">🎙️🟢</div>
        <h3 style="color:var(--neon);font-size:20px;margin-bottom:6px;">جهاز المكالمات الصوتية الحية مقترن ونشط 100%!</h3>
        <p style="font-size:14px;color:var(--text)">أسترو جاهز الآن للرد على أي رنة تليفون في واتساب والتحدث مباشرة بصوت مصري ذكي بنموذج Gemini 3.8 Live.</p>
      </div>
    </div>

  </div>

  <!-- AI Playground + People -->
  <div class="grid-sections">

    <!-- Interactive AI Live Playground -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">🤖 كونسول الذكاء الاصطناعي (AI Playground)</div>
        <select id="persona-select" class="persona-select">
          <option value="dev">👑 المطور أدهم (01273990719)</option>
          <option value="shorouk">💗 شروق (01002135088)</option>
          <option value="user">👤 مستخدم عادي</option>
        </select>
      </div>
      <div class="chat-box" id="playground-chat">
        <div class="msg msg-bot">
          أهلاً يا باشا! أنا استرو.. جرب تكلمني وشوف شخصيتي المصرية وسرعة ردي بدون هلوسة! 😄✨
          <div class="msg-meta">استرو • 0ms</div>
        </div>
      </div>
      <div class="chat-input-row">
        <input type="text" id="playground-input" class="chat-input" placeholder="اكتب رسالة لاسترو واضغط Enter...">
        <button id="playground-send" onclick="sendPlaygroundMsg()" class="chat-btn">إرسال ⚡</button>
      </div>
    </div>

    <!-- Stored Contacts & Memories -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">👥 الأصدقاء وذاكرة استرو</div>
        <span style="font-size:12px;color:var(--muted)" id="people-count">0 شخص</span>
      </div>
      <div id="people-list" style="max-height:300px;overflow-y:auto;">
        <div class="list-row">جارٍ تحميل الذاكرة...</div>
      </div>
    </div>

  </div>

  <!-- Recent Commands Activity Log -->
  <div class="panel" style="margin-top:4px;">
    <div class="panel-header">
      <div class="panel-title">🧾 سجل الأوامر والنشاط الأخير</div>
      <span style="font-size:12px;color:var(--muted)">تحديث تلقائي كل 3 ثواني</span>
    </div>
    <div id="activity-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;">
      <div class="list-row">بانتظار النشاط...</div>
    </div>
  </div>

</div>

<script>
const TOKEN = new URLSearchParams(location.search).get('token') ?? '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtUptime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + ' س ' + m + ' د' : m + ' د ' + (s % 60) + ' ث';
};

async function tick() {
  try {
    const res = await fetch('/stats?token=' + TOKEN, { signal: AbortSignal.timeout(3000) });
    const d = await res.json();

    // KPIs
    document.getElementById('k-uptime').textContent = fmtUptime(d.uptime);
    document.getElementById('k-msgs').textContent = d.messages || 0;
    document.getElementById('k-cmds').textContent = d.commands || 0;
    document.getElementById('k-ai').textContent = d.aiReplies || 0;
    document.getElementById('k-users').textContent = (d.people || []).length;
    document.getElementById('k-db-ping').textContent = (d.database?.pingMs ?? 2) + 'ms';

    // DB Panel
    const dbStat = d.database || {};
    document.getElementById('db-session-count').textContent = (dbStat.sessionFilesCount || 0) + ' ملف';
    document.getElementById('db-kv-count').textContent = (dbStat.kvKeysCount || 0) + ' سجل';
    document.getElementById('db-size').textContent = dbStat.dbSize || 'N/A';
    document.getElementById('db-ping').textContent = (dbStat.pingMs ?? 0) + 'ms';
    document.getElementById('db-health-badge').textContent = dbStat.connected ? '🟢 متصلة وموثوقة' : '🟡 جاري الربط';

    // WA Connection
    const isConn = Boolean(d.connected);
    document.getElementById('wa-status-badge').textContent = isConn ? '🟢 متصل' : '🟡 بانتظار المسح';
    document.getElementById('qrbox').style.display = isConn ? 'none' : 'block';
    document.getElementById('wa-connected-box').style.display = isConn ? 'block' : 'none';
    if (!isConn) {
      document.getElementById('qr-img').src = '/qr.png?t=' + Date.now();
    }

    // 📞 VoIP Live Status & QR Auto-Refresh
    try {
      const vRes = await fetch('/api/voip/status');
      const vData = await vRes.json();
      const vBadge = document.getElementById('voip-status-badge');
      const vQrBox = document.getElementById('voip-qrbox');
      const vConnBox = document.getElementById('voip-connected-box');
      const vImg = document.getElementById('voip-qr-img');

      if (vData.ready) {
        if (vBadge) {
          vBadge.className = 'badge badge-live';
          vBadge.textContent = '🟢 نشط ومقترن 100%';
        }
        if (vQrBox) vQrBox.style.display = 'none';
        if (vConnBox) vConnBox.style.display = 'block';
      } else {
        if (vBadge) {
          vBadge.className = 'badge';
          vBadge.style.background = 'rgba(255,184,0,0.15)';
          vBadge.style.color = 'var(--yellow)';
          vBadge.textContent = '🟡 بانتظار مسح الباركود';
        }
        if (vQrBox) vQrBox.style.display = 'block';
        if (vConnBox) vConnBox.style.display = 'none';
        if (vImg) {
          const ts = String(vData.qrTimestamp || 0);
          if (vImg.getAttribute('data-ts') !== ts) {
            vImg.setAttribute('data-ts', ts);
            vImg.src = '/api/voip/qr.png?t=' + (vData.qrTimestamp || Date.now());
          }
        }
      }
    } catch (_) {}

    // People
    const pList = document.getElementById('people-list');
    pList.innerHTML = (d.people || []).map(p =>
      '<div class="list-row"><div><b>' + esc(p.name) + '</b> <span style="font-size:11px;color:var(--muted)">(' + esc(p.role || 'صديق') + ')</span></div>' +
      '<div style="font-size:12px;color:var(--cyan)">💭 ' + (p.memories || 0) + ' ذكرى • ' + esc(p.ago) + '</div></div>'
    ).join('') || '<div class="list-row">لا يوجد مستخدمين مسجلين بعد</div>';
    document.getElementById('people-count').textContent = (d.people || []).length + ' شخص';

    // Activity
    const actList = document.getElementById('activity-list');
    actList.innerHTML = (d.lastCommands || []).map(cmd =>
      '<div class="list-row" style="background:rgba(0,0,0,0.25);border-radius:10px;padding:8px 12px;"><span>⚡ ' + esc(cmd) + '</span><span style="color:var(--neon);font-size:11px">تم التنفيذ</span></div>'
    ).join('') || '<div class="list-row">لسه مفيش أوامر حديثة</div>';

  } catch (err) {
    console.warn('Dashboard sync:', err.message);
  }
}

// AI Playground chat
async function sendPlaygroundMsg() {
  const input = document.getElementById('playground-input');
  const chat = document.getElementById('playground-chat');
  const text = input.value.trim();
  if (!text) return;

  const persona = document.getElementById('persona-select').value;
  input.value = '';

  const userDiv = document.createElement('div');
  userDiv.className = 'msg msg-user';
  userDiv.innerHTML = esc(text) + '<div class="msg-meta">أنت (' + (persona === 'dev' ? 'أدهم' : persona === 'shorouk' ? 'شروق' : 'مستخدم') + ')</div>';
  chat.appendChild(userDiv);
  chat.scrollTop = chat.scrollHeight;

  const waitDiv = document.createElement('div');
  waitDiv.className = 'msg msg-bot';
  waitDiv.id = 'ai-waiting';
  waitDiv.textContent = 'استرو بيكتب... ⏳';
  chat.appendChild(waitDiv);
  chat.scrollTop = chat.scrollHeight;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, persona })
    });
    const data = await res.json();
    waitDiv.remove();

    const botDiv = document.createElement('div');
    botDiv.className = 'msg msg-bot';
    botDiv.innerHTML = esc(data.reply || 'حصل خطأ في الرد') + '<div class="msg-meta">' + esc(data.engine || 'ai') + ' • ' + (data.latencyMs || 0) + 'ms</div>';
    chat.appendChild(botDiv);
    chat.scrollTop = chat.scrollHeight;
  } catch (err) {
    waitDiv.textContent = '❌ تعذر الاتصال بالذكاء: ' + err.message;
  }
}

document.getElementById('playground-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendPlaygroundMsg();
});

setInterval(tick, 3000);
tick();
</script>
</body>
</html>`;

const VOIP_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ربط مكالمات واتساب الصوتية الحية ⚡ ASTRO AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #070b10;
    --card: rgba(14, 23, 33, 0.88);
    --neon: #00ffa3;
    --cyan: #00d4ff;
    --yellow: #ffb800;
    --text: #e6edf3;
    --muted: #8b949e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: radial-gradient(circle at 50% 20%, #102334 0%, var(--bg) 80%);
    color: var(--text);
    font-family: 'Cairo', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    background: var(--card);
    border: 1px solid rgba(0, 255, 163, 0.25);
    backdrop-filter: blur(16px);
    border-radius: 24px;
    padding: 32px 24px;
    max-width: 440px;
    width: 100%;
    text-align: center;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  }
  h1 { font-size: 22px; font-weight: 900; background: linear-gradient(135deg, var(--neon), var(--cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
  .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; background: rgba(0,255,163,0.12); color: var(--neon); border: 1px solid rgba(0,255,163,0.3); margin-bottom: 20px; }
  .qr-wrapper {
    background: #ffffff;
    border-radius: 16px;
    padding: 16px;
    display: inline-block;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    margin-bottom: 16px;
  }
  .qr-img { width: 280px; height: 280px; display: block; border-radius: 4px; image-rendering: pixelated; }
  .instructions { text-align: right; background: rgba(0,0,0,0.3); border-radius: 14px; padding: 16px; margin-top: 14px; font-size: 13px; line-height: 1.8; border: 1px solid rgba(255,255,255,0.06); }
  .instructions ol { padding-right: 20px; color: #cbd5e1; }
  .instructions li { margin-bottom: 4px; }
  .success-box { display: none; padding: 30px 10px; }
</style>
</head>
<body>
<div class="card">
  <h1>📞 مكالمات واتساب الصوتية الحية</h1>
  <div class="badge" id="status-badge">🔄 الباركود نشط ويتجدد تلقائياً</div>
  
  <div id="qr-section">
    <div class="qr-wrapper">
      <img id="qr-img" class="qr-img" src="/api/voip/qr.png" alt="VoIP QR">
    </div>
    <p style="font-size: 12px; color: var(--neon); margin-bottom: 12px;">🔄 يتجدد الباركود تلقائياً بدون الحاجة لتحديث الصفحة</p>
    
    <div class="instructions">
      <strong style="color:var(--neon);display:block;margin-bottom:6px;">📲 خطوات الربط في ثوانٍ:</strong>
      <ol>
        <li>افتح تطبيق <b>واتساب</b> على هاتفك 📱</li>
        <li>ادخل على <b>الأجهزة المرتبطة</b> (<i>Linked Devices</i>)</li>
        <li>اضغط على <b>ربط جهاز</b> (<i>Link a Device</i>)</li>
        <li>وجّه كاميرا الهاتف إلى الباركود أعلاه مباشرة!</li>
      </ol>
    </div>
  </div>

  <div id="success-section" class="success-box">
    <div style="font-size: 64px; margin-bottom: 12px;">🎉🎙️</div>
    <h2 style="color:var(--neon);font-size:22px;margin-bottom:8px;">تم الربط بنجاح 100%!</h2>
    <p style="color:var(--text);font-size:14px;line-height:1.6;">جهاز المكالمات الصوتية مقترن الآن بنظام الأجهزة المتعددة.<br>أسترو جاهز للرد على أي مكالمة صوتية والتحدث مباشرة عبر الذكاء الاصطناعي!</p>
  </div>
</div>

<script>
  let isPaired = false;
  async function check() {
    try {
      const res = await fetch('/api/voip/status');
      const data = await res.json();
      if (data.ready) {
        if (!isPaired) {
          isPaired = true;
          document.getElementById('qr-section').style.display = 'none';
          document.getElementById('success-section').style.display = 'block';
          document.getElementById('status-badge').textContent = '🟢 متصل ونشط 100%';
          document.getElementById('status-badge').style.borderColor = 'var(--neon)';
        }
      } else {
        const img = document.getElementById('qr-img');
        if (img) {
          const ts = String(data.qrTimestamp || 0);
          if (img.getAttribute('data-ts') !== ts) {
            img.setAttribute('data-ts', ts);
            img.src = '/api/voip/qr.png?t=' + (data.qrTimestamp || Date.now());
          }
        }
      }
    } catch (_) {}
  }
  setInterval(check, 3000);
  check();
</script>
</body>
</html>`;

export function startQrServer(port = 3000) {
  const isCloud = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.CRANL || process.env.NODE_ENV === 'production' || !!process.env.PORT;
  let authToken = config.dashToken || '';
  if (!authToken && isCloud) {
    authToken = randomBytes(16).toString('hex');
    console.log(`🔐 DASH_TOKEN مش متحدد — ولّدت توكن اختياري للداشبورد:\n   ?token=${authToken}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      // 🩺 فحص الصحة للسحابة والكونتينر
      if (req.url === '/health' || req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bot: config.botName }));
        return;
      }

      // 📞 غرفة المكالمة الصوتية الحية عبر Gemini 3.8 Live
      if (req.url === '/call' || req.url === '/live' || req.url === '/voice') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(CALL_PAGE);
        return;
      }

      // 🔐 حماية الإحصائيات بكلمة سر لو تم تحديد DASH_TOKEN
      if (config.dashToken && req.url.startsWith('/stats')) {
        const url = new URL(req.url, 'http://x');
        if (url.searchParams.get('token') !== config.dashToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }

      // 🤖 كونسول تجربة واختبار الذكاء الاصطناعي (AI Live Playground)
      if (req.url === '/api/ai/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const { text, persona = 'dev' } = JSON.parse(body);
            if (!text) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Text required' }));
            }
            let sender = '201273990719@s.whatsapp.net';
            let senderAlt = '201273990719';
            let pushName = 'أدهم المطور';
            if (persona === 'shorouk') {
              sender = '201002135088@s.whatsapp.net';
              senderAlt = '201002135088';
              pushName = 'شروق';
            } else if (persona === 'user') {
              sender = '201099999999@s.whatsapp.net';
              senderAlt = '201099999999';
              pushName = 'صديق جديد';
            }
            const t0 = Date.now();
            const result = await chatWithAI({
              text,
              key: sender,
              sender,
              senderAlt,
              pushName,
            });
            const reply = typeof result === 'string' ? result : (result?.reply ?? '');
            const engine = result?.engine || 'gemini-vex';
            const latencyMs = Date.now() - t0;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ reply, engine, latencyMs }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // صورة QR — تتولد كـ PNG
      if (req.url.startsWith('/qr.png')) {
        const qr = readQr();
        if (!qr) {
          res.writeHead(404);
          res.end();
          return;
        }
        const buf = await QRCode.toBuffer(qr, { width: 420, margin: 2 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(buf);
        return;
      }

      // بيانات JSON للـ QR + النسخة النصية الاحتياطية
      if (req.url.startsWith('/qr')) {
        const qr = readQr();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ qr, ascii: qr ? asciiQr(qr) : '' }));
        return;
      }

      // 📞 صفحة مسح باركود مكالمات واتساب الصوتية الحية المنفصلة
      if (req.url === '/voip-qr' || req.url === '/voip/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(VOIP_PAGE);
        return;
      }

      // 📞 صورة باركود المكالمات الصوتية الحية (Live VoIP QR PNG)
      if (req.url.startsWith('/api/voip/qr.png') || req.url === '/voip.png') {
        try {
          const { getLatestVoipQr, isZapoReady, startZapoVoipEngine, getZapoClient } = await import('./zapo-engine.js');
          if (isZapoReady()) {
            res.writeHead(204);
            res.end();
            return;
          }
          if (!getZapoClient()) {
            startZapoVoipEngine().catch(() => {});
          }
          let qr = getLatestVoipQr();
          if (!qr) {
            for (let i = 0; i < 8; i++) {
              await new Promise((r) => setTimeout(r, 500));
              qr = getLatestVoipQr();
              if (qr) break;
            }
          }
          if (!qr) {
            // صورة باركود بيضاء نقية 100% طبيعية متوافقة تماماً
            const buf = await QRCode.toBuffer('https://nova-bot-x3unfm.cranl.net/voip-qr', {
              width: 400,
              margin: 4,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'M'
            });
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
            res.end(buf);
            return;
          }
          // باركود طبيعي رسمي 100% (أسود على أبيض ناصع) متوافق تماماً مع كاميرا تطبيق واتساب
          const buf = await QRCode.toBuffer(qr, {
            width: 400,
            margin: 4,
            color: { dark: '#000000', light: '#ffffff' },
            errorCorrectionLevel: 'M'
          });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          res.end(buf);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(err.message);
        }
        return;
      }

      // 📞 فحص حالة جهاز المكالمات الصوتية الحية (VoIP Live Status)
      if (req.url.startsWith('/api/voip/status')) {
        try {
          const { getVoipStatus } = await import('./zapo-engine.js');
          const status = getVoipStatus();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(status));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // 📞 كود ربط جهاز مكالمات واتساب الصوتية الحية
      if (req.url.startsWith('/api/voip/code') || req.url === '/voip-code') {
        try {
          const { getLatestPairingCode, requestPairingCodeNow, isZapoReady } = await import('./zapo-engine.js');
          const ready = isZapoReady();
          let code = getLatestPairingCode();
          if (!code && !ready) {
            try {
              code = await requestPairingCodeNow();
            } catch (_) {}
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ready, code, phone: config.pairingPhone || '201226110887' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // 💾 تصدير نسخة احتياطية من الجلسة
      if (req.url === '/api/session/export') {
        const dump = await exportSessionDump(SESSION_DIR);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="nova-session-backup.json"',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(dump, null, 2));
        return;
      }

      // 📥 استيراد نسخة احتياطية للجلسة
      if (req.url === '/api/session/import' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            const count = await importSessionDump(SESSION_DIR, parsed);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, count }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // 📊 بيانات الداشبورد الحية وقاعدة البيانات
      if (req.url.startsWith('/stats')) {
        const snap = await fullSnapshot();
        const users = db.get('users', {});
        const people = Object.entries(users).map(([k, p]) => {
          const ago = p.lastSeen ? Math.round((Date.now() - p.lastSeen) / 3600000) : null;
          return {
            name: p.name ?? k.split('@')[0],
            role: p.role ?? 'صديق',
            memories: (p.memories ?? []).length,
            ago: ago === null ? '—' : ago < 1 ? 'منذ دقائق' : ago + ' ساعة',
          };
        });
        const connected = typeof snap.connected === 'boolean' ? snap.connected : !readQr();
        const dbStats = await getDbStats().catch(() => ({
          connected: isDbConnected(),
          configured: isDbConfigured(),
        }));

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          ...snap,
          people,
          connected,
          database: dbStats,
        }));
        return;
      }

      // 📊 صفحة الداشبورد
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE);
    } catch (err) {
      console.error('❌ خطأ في الداشبورد:', err.message);
      res.writeHead(500);
      res.end('error');
    }
  });

  const host = '0.0.0.0';
  server.on('error', (err) => {
    console.error('❌ سيرفر الداشبورد فشل:', err.message);
  });

  // 🎙️ تفعيل خادم المكالمات الصوتية الحية (Live Voice Calling WebSockets)
  try {
    initLiveCallWs(server);
    console.log('🎙️ محرك المكالمات الصوتية الحية (Gemini 3.8 Live WS) نشط على /ws/live-call');
  } catch (err) {
    console.warn('⚠️ تعذر بدء محرك المكالمات الحية على السيرفر:', err.message);
  }

  server.listen(port, host, () => {
    console.log(`🌐 لوحة التحكم المتطورة: http://0.0.0.0:${port}`);
    console.log(`📞 غرفة المكالمة الصوتية الحية: http://0.0.0.0:${port}/call`);
  });
  return server;
}
