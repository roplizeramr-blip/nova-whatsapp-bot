import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
} from '@rexxhayanasi/elaina-baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { loadCommands } from './loader.js';
import { handleUpsert, startCooldownSweep } from './handler.js';
import { getSettings, startProtectionSweep } from './protection.js';
import { resolveKey } from './identity.js';
import { startScheduler } from './proactive.js';
import { migrateOldData } from './memory.js';
import { setBotIdentity, clearCanonicalCache } from './identity.js';
import { startMaintenance } from './maintenance.js';
import { setGroupsProvider, setApiStatus, setConnected } from './stats.js';
import { db } from './db.js';
import { QR_FILE } from './qr-server.js';
import api, { setOwnerNotifier, onApiStatus } from './api.js';
import { initCallEngine } from './call-engine.js';
import {
  restoreSessionFromDb,
  scheduleSessionSync,
  syncSessionToDb,
  clearSessionFromDb,
} from './postgres.js';

const logger = pino({ level: 'silent' });
const __dirname = dirname(fileURLToPath(import.meta.url));
// ☁️ على Railway: التخزين كله جوّه الـ volume الواحد /app/session
const SESSION_DIR = join(__dirname, '..', 'session');
// ملف الـ QR: نفس المسار اللي سيرفر الداشبورد بيقرا منه (مُعرَّف هناك مرة واحدة)

// 🔄 حالة إعادة الاتصال — backoff + منع تداخل المحاولات
let reconnecting = false;
let reconnectAttempts = 0;
// 🔁 عداد إقلاعات ما بعد الـ logout — حماية من لوب لا نهائي لو الجلسة بتتسجل
// خروج ورا بعض. بيتصفر أول ما الاتصال ينجح.
let logoutRestarts = 0;
// دوال الإيقاف عشان ما نعملش intervals مكرّرة على كل reconnect
let stopScheduler = null;
let stopMaint = null;
let stopSweep = null;

// صفحة الويب بتقرا الكود من الملف ده عشان تعرض أحدث QR دايمًا
function saveQr(qr) {
  fs.mkdirSync(dirname(QR_FILE), { recursive: true });
  fs.writeFileSync(QR_FILE, qr);
}

export async function startBot() {
  // 🐘 استرجاع ملفات الجلسة من قاعدة بيانات PostgreSQL السحابية لو كانت موجودة
  await restoreSessionFromDb(SESSION_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  // 🧠 ترحيل الذاكرة القديمة للهويات الجديدة (مرة واحدة)
  migrateOldData();

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    console.warn('⚠️ مقدرتش أجيب أحدث إصدار واتساب — هستخدم الإصدار المدمج');
  }

  const { commands, categories, errors, collisions, shadowedCount } = await loadCommands();
  if (errors.length) {
    console.warn('⚠️ أوامر اتحملت غلط:');
    errors.forEach((e) => console.warn('   •', e));
  }
  if (collisions.length) {
    console.warn('⚠️ أسماء أوامر متعارضة (الأول كسب):');
    collisions.forEach((c) => console.warn(`   • '${c.alias}' → '${c.winner}' غطّى '${c.shadowed}'`));
  }
  if (shadowedCount) {
    console.warn(`⚠️ ${shadowedCount} أمر كل أسمائه متاخدة — مش هيظهر في المنيو ولا ينفذ`);
  }
  const totalCommands = [...categories.values()].reduce((sum, cmds) => sum + cmds.length, 0);
  console.log(`📦 تم تحميل ${totalCommands} أمر في ${categories.size} قسم${errors.length ? ` (وفشل تحميل ${errors.length})` : ''}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    scheduleSessionSync(SESSION_DIR, 2000);
  });
  sock.ev.on('connection.update', (update) => onConnectionUpdate(sock, update));
  sock.ev.on('messages.upsert', (upsert) => handleUpsert(sock, { commands, categories }, upsert));

  // 📞 تفعيل محرك مراقبة واستقبال المكالمات الصوتية الحية (Gemini 3.8 Live VoIP Engine)
  initCallEngine(sock);

  // 🆔 هوية البوت نفسه — عشان متتخلطش بذاكرة الناس + 🧹 الصيانة الدورية
  setBotIdentity(sock);
  stopMaint?.();
  stopMaint = startMaintenance();
  startCooldownSweep();
  stopSweep?.();
  stopSweep = startProtectionSweep();

  // 📊 حالة الـ API على الداشبورد — كان بيقول "شغال" دايمًا
  onApiStatus((status, openCount) => setApiStatus(status, openCount));

  // 🔄 مزامنة LID ← رقم التليفون تلقائيًا (التعرف بيشتغل مع أي شخص جديد)
  sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
    if (!lid || !pn) return;
    const aliases = db.get('identities', {});
    aliases[String(lid)] = String(pn).includes('@') ? String(pn) : `${String(pn).split(':')[0]}@s.whatsapp.net`;
    const target = aliases[String(lid)];
    aliases[target] = target;
    db.set('identities', aliases);
    clearCanonicalCache(); // 🆔 خريطة الهويات اتحدثت — الكاش القديم ميصلحش
  });

  // 📊 الداشبورد: قايمة الجروبات الحية (مع كاش وحماية من التعليق)
  let cachedGroups = [];
  let lastGroupFetch = 0;
  setGroupsProvider(async () => {
    if (!sock?.user) return [];
    const now = Date.now();
    if (now - lastGroupFetch < 60000 && cachedGroups.length) return cachedGroups;
    try {
      const groups = await Promise.race([
        sock.groupFetchAllParticipating(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
      ]);
      cachedGroups = Object.values(groups || {}).map((g) => ({ subject: g.subject, size: g.participants?.length ?? 0 }));
      lastGroupFetch = now;
      return cachedGroups;
    } catch {
      return cachedGroups;
    }
  });

  // 📣 المجدول: تذكيرات + صباح الخير + التحدي اليومي + متابعة الغايبين + صدارة الجمعة
  // ⛔ بنوقف المجدول القديم الأول — من غير كده كل إعادة اتصال بتسيب
  // interval شغّال جديد وبيشتغلوا كلهم على نفس الـ DB
  stopScheduler?.();
  stopScheduler = startScheduler(sock);

  // 🚨 كشف Raid: دخلوا 5+ أعضاء في دقيقة → قفل تلقائي للجروب + تنبيه المالك
  const raidMap = new Map();
  sock.ev.on('group-participants.update', async (event) => {
    // ⚠️ كان بيفكك الـ event في برميتار الدالة من غير try/catch — أي error هنا
    // كان unhandled rejection. كمان بيموت أول ما participants تبقى مش array.
    try {
      const { id, participants, action } = event ?? {};
      if (action !== 'add' || !Array.isArray(participants) || !participants.length) return;
      const now = Date.now();
      const joins = (raidMap.get(id) ?? []).filter((t) => now - t < 60000);
      joins.push(now);
      raidMap.set(id, joins);
      if (joins.length >= 5) {
        raidMap.set(id, []);
        await sock.groupSettingUpdate(id, 'announcement'); // قفل الجروب (أدمن بس يكتب)
        await sock.sendMessage(id, { text: '🚨 اتحشر ضغط دخول! الجروب اتقفل مؤقتًا لحمايته — الأدمن يفتحه من إعدادات واتساب' });
        const ownerNum = config.owners?.[0];
        if (ownerNum) {
          await sock.sendMessage(`${ownerNum}@s.whatsapp.net`, {
            text: `🚨 Raid محتمل في جروب (${id.slice(0, 15)}...): دخلوا ${joins.length} أعضاء في دقيقة — الجروب اتقفل تلقائيًا`,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('⚠️ كشف Raid فشل:', err.message?.slice(0, 60));
    }
  });

  // 🔔 تنبيه المالك بأخطاء الـ API الحرجة (لو رقمه متسجل)
  const ownerNum = config.owners?.[0];
  if (ownerNum) {
    const ownerJid = `${String(ownerNum).replace(/\D/g, '')}@s.whatsapp.net`;
    setOwnerNotifier((text) => {
      sock.sendMessage(ownerJid, { text }).catch(() => {});
    });
  }

  // 👋 الترحيب/الوداع + إزالة المحظور عند دخوله مجددًا
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      if (!Array.isArray(participants) || !participants.length) return;
      const s = getSettings(id);
      const meta = await sock.groupMetadata(id).catch(() => null);
      const groupName = String(meta?.subject ?? 'الجروب');

      for (const p of participants) {
        const jid = typeof p === 'string' ? p : (p?.id ?? p?.jid);
        if (!jid) continue;
        const digits = String(jid).split(':')[0].split('@')[0];
        const targetJid = jid.includes('@lid') ? jid : `${digits}@s.whatsapp.net`;
        const getPic = async () => {
          let pp = await sock.profilePictureUrl(targetJid, 'image').catch(() => null);
          if (!pp && jid !== targetJid) {
            pp = await sock.profilePictureUrl(jid, 'image').catch(() => null);
          }
          return pp;
        };

        // 🚫 فحص القائمة السوداء عند الدخول
        if (action === 'add' && s.banned) {
          const canonical = resolveKey(jid) ?? jid;
          const banned = s.banned[canonical] ?? s.banned[jid] ??
            Object.keys(s.banned).find((k) => k.split('@')[0] === digits);
          if (banned) {
            await sock.groupParticipantsUpdate(id, [jid], 'remove').catch((err) => {
              console.warn('⚠️ تعذرت إزالة عضو محظور:', err.message?.slice(0, 70));
            });
            await sock.sendMessage(id, {
              text: `🚫 تمت إزالة @${digits} من القائمة السوداء. (ملاحظة: واتساب لا يمنع إعادة الدعوة نهائيًا)`,
              mentions: [jid],
            }).catch(() => {});
            continue;
          }
        }

        const memberCount = meta?.participants?.length ?? '—';
        const cairoTime = new Date().toLocaleTimeString('ar-EG', {
          timeZone: 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
        });

        // 👑 تنبيه الترقية لأدمن مع صورة البروفايل
        if (action === 'promote') {
          const promoteMsg =
            `╭───『 👑 ألـف مـبـروك الـتـرقـيـة 👑 』───╮\n` +
            `│\n` +
            `│ 👤 المشرف الجديد: @${digits}\n` +
            `│ 🏰 الجروب: *${groupName}*\n` +
            `│ 🛡️ الرتبة: مسؤول ومشرف الجروب (Admin)\n` +
            `│ ⏰ التوقيت: ${cairoTime} (بتوقيت القاهرة)\n` +
            `│\n` +
            `│ 🌟 ألف مبروك الثقة يا كبير ومنور الإدارة! 👑\n` +
            `│ 🤝 بالتوفيق في تنظيم الجروب وخدمة الأعضاء ✨\n` +
            `│\n` +
            `╰─────────────────────────╯`;
          const picUrl = await getPic();
          if (picUrl) {
            await sock.sendMessage(id, { image: { url: picUrl }, caption: promoteMsg, mentions: [jid] }).catch(async () => {
              await sock.sendMessage(id, { text: promoteMsg, mentions: [jid] });
            });
          } else {
            await sock.sendMessage(id, { text: promoteMsg, mentions: [jid] }).catch(() => {});
          }
          continue;
        }

        // ⬇️ تنبيه التنزيل من الإدارة مع صورة البروفايل
        if (action === 'demote') {
          const demoteMsg =
            `╭───『 ⬇️ تـنـبـيـه إداري ⬇️ 』───╮\n` +
            `│\n` +
            `│ 👤 العضو: @${digits}\n` +
            `│ 🏰 الجروب: *${groupName}*\n` +
            `│ 📌 الحالة: تم تنزيله من الإشراف ورجع عضو عادي\n` +
            `│ ⏰ التوقيت: ${cairoTime} (بتوقيت القاهرة)\n` +
            `│\n` +
            `│ 🤍 بنشكرك على كل مجهودك وتعبك السابق في الجروب!\n` +
            `│\n` +
            `╰─────────────────────────╯`;
          const picUrl = await getPic();
          if (picUrl) {
            await sock.sendMessage(id, { image: { url: picUrl }, caption: demoteMsg, mentions: [jid] }).catch(async () => {
              await sock.sendMessage(id, { text: demoteMsg, mentions: [jid] });
            });
          } else {
            await sock.sendMessage(id, { text: demoteMsg, mentions: [jid] }).catch(() => {});
          }
          continue;
        }

        // 👋 رسائل الترحيب بصورة البروفايل ومنشن العضو
        if (action === 'add' && s.welcome !== false) {
          const defaultWelcome =
            `╭───『 🌟 أهـلاً ومـرحبـاً بـك 🌟 』───╮\n` +
            `│\n` +
            `│ 👤 العضو الجديد: @${digits}\n` +
            `│ 🏰 الجروب: *${groupName}*\n` +
            `│ 👥 عدد الأعضاء: ${memberCount} عضو\n` +
            `│ ⏰ التوقيت: ${cairoTime} (بتوقيت القاهرة)\n` +
            `│\n` +
            `│ 🥳 نورت عيلتنا يا غالي وسعداء جداً بانضمامك! ✨\n` +
            `│ 📜 التزم بالقوانين وخليك محترم وسط إخواتك ❤️\n` +
            `│ 💬 اكتب .الاوامر لو حابب تكتشف خدمات البوت ⚡\n` +
            `│\n` +
            `╰─────────────────────────╯`;
          const welcomeMsg = s.welcomeText
            ? s.welcomeText.replaceAll('{user}', '@' + digits).replaceAll('{group}', groupName)
            : defaultWelcome;

          const picUrl = await getPic();
          if (picUrl) {
            await sock.sendMessage(id, { image: { url: picUrl }, caption: welcomeMsg, mentions: [jid] }).catch(async () => {
              await sock.sendMessage(id, { text: welcomeMsg, mentions: [jid] });
            });
          } else {
            await sock.sendMessage(id, { text: welcomeMsg, mentions: [jid] });
          }
          continue;
        }

        // 👋 رسائل المغادرة بصورة البروفايل ومنشن العضو
        if (action === 'remove' && (s.goodbye || s.goodbyeText)) {
          const defaultGoodbye =
            `╭───『 🕊️ فـي أمـان الـلـه 🕊️ 』───╮\n` +
            `│\n` +
            `│ 👤 العضو المغادر: @${digits}\n` +
            `│ 🏰 الجروب: *${groupName}*\n` +
            `│ 👥 الأعضاء المتبقين: ${memberCount} عضو\n` +
            `│ ⏰ التوقيت: ${cairoTime} (بتوقيت القاهرة)\n` +
            `│\n` +
            `│ 💔 هنفتقدك يا غالي ونتمنى لك كل التوفيق!\n` +
            `│ 🚪 باب الجروب مفتوح لك دايماً لو حبيت ترجع 🌸\n` +
            `│\n` +
            `╰─────────────────────────╯`;
          const goodbyeMsg = s.goodbyeText
            ? s.goodbyeText.replaceAll('{user}', '@' + digits).replaceAll('{group}', groupName)
            : defaultGoodbye;

          const picUrl = await getPic();
          if (picUrl) {
            await sock.sendMessage(id, { image: { url: picUrl }, caption: goodbyeMsg, mentions: [jid] }).catch(async () => {
              await sock.sendMessage(id, { text: goodbyeMsg, mentions: [jid] });
            });
          } else {
            await sock.sendMessage(id, { text: goodbyeMsg, mentions: [jid] });
          }
        }
      }
    } catch (err) {
      console.error('⚠️ خطأ في ترحيب/إدارة الأعضاء:', err.message);
    }
  });
}

function onConnectionUpdate(sock, { connection, lastDisconnect, qr }) {
  // 🔢 ربط بكود الهاتف (لو مفعّل في الإعدادات)
  if (qr && config.pairingPhone && !sock.authState?.creds?.registered) {
    const phone = String(config.pairingPhone).replace(/\D/g, '');
    sock.requestPairingCode(phone)
      .then((code) => {
        const pretty = code?.match(/.{1,4}/g)?.join('-') ?? code;
        console.log(`\n🔢 كود الربط: ${pretty}`);
        console.log('اكتبه في: واتساب → الأجهزة المرتبطة → ربط ببكود الهاتف\n');
      })
      .catch((err) => console.error('❌ فشل توليد كود الربط:', err));
    return;
  }

  // 📷 ربط برمز QR
  if (qr) {
    saveQr(qr);
    console.log('\n📲 افتح واتساب → الأجهزة المرتبطة → ربط جهاز، وامسح الكود ده:\n');
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'open') {
    saveQr('');
    setConnected(true);
    resetReconnectBackoff();
    logoutRestarts = 0; // اتصلّنا بنجاح — عداد الـ logout يبدأ من جديد
    const number = sock.user?.id?.split(':')[0] ?? '';
    console.log(`\n✅ ${config.botName} ${config.botEmoji} شغال! (مرتبط بـ ${number})`);
    console.log(`🧩 البادئة: ${config.prefix} — جرّب اكتب ${config.prefix}menu في أي شات\n`);
    // 💾 مزامنة كل ملفات الجلسة مع قاعدة بيانات PostgreSQL السحابية فور فتح الاتصال
    syncSessionToDb(SESSION_DIR).catch(() => {});

    // 🚀 تنبيه المالك (عمرو 01044626335) بالجاهزية والاتصال الحي
    const primaryOwnerJid = '201044626335@s.whatsapp.net';
    setTimeout(async () => {
      try {
        await sock.sendMessage(primaryOwnerJid, {
          text: `🚀 *أهلاً بك يا ريس!* ⚡\n\nتم تشغيل وتحديث *${config.botName}* بنجاح وهو متصل وشغال 100% الآن!\n\n✨ *أبرز التحديثات التي تمت:*
• ⚡ تسريع البحث باليوتيوب (Direct Scraper في 1 ثانية).
• 🎨 دعم تعديل وتوليد الصور التلقائي بدون أي أخطاء 500.
• 🧠 تفعيل الذكاء الاصطناعي الفائق (VEX Gemini).
• 📱 99 أمراً نشطاً في 11 قسماً.

💡 *جرب الآن من هاتفك الأوامر التالية:*
• \`.menu\` (عرض القائمة التفاعلية الشاملة)
• \`.yt لا اله الا الله\` (بحث فيديو يوتيوب مع أزرار التحميل)
• \`.song عمرو دياب\` (بحث وتحميل الأغاني)
• \`.image صورة رائد فضاء كرتوني\`
• \`.فحص\` (تشغيل الفحص الشامل التلقائي المباشر لجميع الميزات)`,
        });
      } catch (err) {
        console.warn('⚠️ تعذر إرسال رسالة الإقلاع للمالك:', err.message);
      }
    }, 2500);
  }

  if (connection === 'close') {
    setConnected(false);
    const code = lastDisconnect?.error?.output?.statusCode;
    if (code === DisconnectReason.loggedOut) {
      console.log('❌ الجلسة اتسجلت خروج — بنمسح بيانات المصادقة وبنولّد QR جديد');
      // ⚠️ كان بيمسح SESSION_DIR كله — وده على Railway فيه data/db.json
      // (لأن DATA_DIR = session/data) يعني كل ذاكرة الناس والاقتصاد
      // والتذكيرات اتمسحت مع ملفات الدخول. دلوقتي بنمسح المصادقة بس.
      clearAuthFiles();
      clearSessionFromDb().catch(() => {});
      // ⛔ قبلكان كنا بنعمل return وخلاص — البوت بيفضل ميت من غير QR جديد
      // لحد ريستارت يدوي والداشبورد يقول «متصل»! بنشغّل البوت تاني عشان
      // يتولد QR، مع عداد حماية من اللوب اللانهائي.
      logoutRestarts++;
      if (logoutRestarts <= 5) {
        setTimeout(() => {
          startBot().catch((err) => console.error('❌ فشل الإقلاع بعد الـ logout:', err.message));
        }, 2000);
      } else {
        console.error('⛔ الـ logout اتكرر 5 مرات — بنوقف الإقلاع التلقائي، راجع اللوج');
      }
      return;
    }

    // ⛔ إعادة اتصال واحدة بس في نفس الوقت
    if (reconnecting) {
      console.log('⏳ في إعادة اتصال جارية بالفعل — مستني');
      return;
    }
    reconnecting = true;

    // 📈 backoff: 3ث → 6ث → 12ث → 30ث (الحد الأقصى). قبل كده كان بيحاول
    // كل 3 ثواني للأبد لو الشبكة تعبانة = إعادة تحميل كل الأوامر + intervals
    // جديدة في كل مرة.
    const delay = Math.min(30000, 3000 * 2 ** Math.min(reconnectAttempts, 4));
    reconnectAttempts++;
    // 🧾 لوج واحد منظم: رقم المحاولة + الكود + سبب مفهوم + مدة الانتظار
    const reason = DISCONNECT_REASONS[code] ?? 'سبب غير معروف';
    console.log(`🔄 قطع اتصال #${reconnectAttempts} (كود ${code} — ${reason}) — إعادة المحاولة بعد ${delay / 1000} ثانية...`);

    setTimeout(() => {
      startBot()
        .catch((err) => console.error('❌ فشل إعادة الاتصال:', err.message))
        .finally(() => {
          reconnecting = false;
        });
    }, delay);
  }
}

// أسماء مفهومة لأكواد قطع الاتصال — عشان اللوج يقول السبب مش رقم غامض
const DISCONNECT_REASONS = {
  [DisconnectReason.connectionClosed]: 'الاتصال اتقفل',
  [DisconnectReason.connectionLost]: 'الاتصال ضاع',
  [DisconnectReason.connectionReplaced]: 'جلسة جديدة فتحت في مكان تاني',
  [DisconnectReason.timedOut]: 'المهلة خلصت',
  [DisconnectReason.restartRequired]: 'محتاج إعادة تشغيل',
  [DisconnectReason.multilogin]: 'تسجيل دخول متعدد',
};

// 🧹 مسح ملفات المصادقة فقط — سيب مجلد data (الذاكرة/الاقتصاد) زي ما هو
function clearAuthFiles() {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    for (const name of fs.readdirSync(SESSION_DIR)) {
      // ملفات المصادقة بس: creds + مفاتيح الإشارات
      if (name === 'creds.json' || name === 'creds.json.bak' || name.startsWith('app-state')) {
        fs.rmSync(join(SESSION_DIR, name), { force: true });
      }
    }
    // ملفات الـ lid/device-list موجودة في مجلد فرعي جوه session
    for (const sub of ['lid-mapping', 'device-list', 'pre-key']) {
      const dir = join(SESSION_DIR, sub);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('⚠️ فشل تنظيف ملفات المصادقة:', err.message);
  }
}

// ✅ نجح الاتصال → نصفّر عداد المحاولات. قبل كده الشرط كان `if (reconnecting)`
// وده عمره ما بيتحقق: 'open' بيوصّل بعد ما finally بتاع startBot يكون خلص
// وخمّد reconnecting = false — فالعداد كان بيكبر للأبد، وقطع بسيط متفرق بعد
// يوم شغل بياخد 30 ثانية انتظار بدل 3 ثواني.
function resetReconnectBackoff() {
  reconnectAttempts = 0;
}
