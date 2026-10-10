import WebSocket from 'ws';
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

import { startBot } from './core/connection.js';
import { startQrServer } from './core/qr-server.js';
import { config } from './config.js';

// ⚠️ كان بيعمل log بس ومبيرحشش. ده معناه إن أي خطأ قاتل (EPIPE من ffmpeg،
// Baileys internal throw) بيسيب البوت شغّال ناقص — Railway شايفه healthy
// ومش بيعيد التشغيل، فالerosion بتتراكم والكل بيحس إن البوت "وهي" بيموت.
// الحل: نسجّل الخطأ، ننضّف، وبعدين نخرج — Railway هيعيد تشغيل نضيف.
process.on('uncaughtException', (err) => {
  console.error('❌ خطأ غير متوقع:', err);
  flushAndExit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('❌ وعد مرفوض:', err);
});

function flushAndExit(code) {
  try {
    // نخلّي الب dusting يكمّل الكتابة قبل ما نطلع (db.json debounced)
    import('./core/db.js')
      .then(({ db }) => db.flush?.())
      .catch(() => {})
      .finally(() => process.exit(code));
  } catch {
    process.exit(code);
  }
}

// ⛔ إيقاف نظيف — نكتب الداتا ونخرج. Railway بيبعت SIGTERM عند إعادة النشر.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`\n👋 ${sig} — بنقفل بهدوء...`);
    flushAndExit(0);
  });
}

console.log(`
╔══════════════════════════════════╗
║        ${config.botName} ${config.botEmoji}              ║
║   Unofficial WhatsApp Bot ⚔️    ║
╚══════════════════════════════════╝
`);

// ☁️ على Railway: السيرفر لازم يسمع فورًا (Railway بيقتل الخدمة لو ما استجابتش)
// عشان كده بنشغّله قبل أي حاجة تانية، والبوت بعده في الخلفية
if (config.qrServerPort) startQrServer(config.qrServerPort);

startBot().catch((err) => {
  console.error('❌ فشل تشغيل البوت:', err);
  process.exit(1);
});
