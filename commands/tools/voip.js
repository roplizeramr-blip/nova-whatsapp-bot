import { sendText } from '../../core/send.js';
import { isZapoReady, getLatestPairingCode, requestPairingCodeNow } from '../../core/zapo-engine.js';

export default {
  name: 'voip',
  aliases: ['مكالمة', 'مكالمات', 'اتصال', 'كود_المكالمات', 'كود_المكالمة'],
  description: 'فحص حالة مكالمات واتساب الصوتية الحية أو طلب كود ربط جهاز المكالمات — .voip',
  async execute(sock, m, args) {
    const targetJid = m.jid;

    if (isZapoReady()) {
      return sendText(
        sock,
        targetJid,
        `🟢 *محرك مكالمات واتساب الصوتية الحية نشط ومقترن بنجاح 100%!* ⚡\n\n` +
        `📞 أسترو جاهز الآن للرد التلقائي داخل شاشة واتساب والتحدث معك بصوته المصري وخفة دمه بمجرد أن ترن عليه هاتفياً!\n` +
        `🎙️ النموذج الصوتي: *Gemini 3.8 Live Extended Thinking*`
      );
    }

    await sendText(sock, targetJid, '⏳ جاري فحص محرك المكالمات وتوليد كود الربط السريع...');

    let code = getLatestPairingCode();
    if (!code) {
      try {
        code = await requestPairingCodeNow();
      } catch (err) {
        return sendText(sock, targetJid, `⚠️ تعذر توليد كود الربط حالياً: ${err.message}`);
      }
    }

    if (!code) {
      return sendText(sock, targetJid, '⚠️ محرك المكالمات قيد التهيئة، يرجى إعادة المحاولة بعد بضع ثوانٍ.');
    }

    const msg =
      `╭───『 📞 تـفـعـيـل مـكـالـمـات واتـسـاب الـحـيـة ⚡ 』───╮\n` +
      `│\n` +
      `│ 📷 *مسح الباركود المباشر (أسرع طريقة):*\n` +
      `│ افتح لوحة التحكم وامسح الباركود بكاميرا واتساب:\n` +
      `│ https://nova-bot-x3unfm.cranl.net/voip-qr\n` +
      `│\n` +
      `│ 🔢 *أو عبر كود الأرقام:* *${code}*\n` +
      `│ 📲 خطوات التفعيل:\n` +
      `│ 1. واتساب > الأجهزة المرتبطة > ربط جهاز\n` +
      `│ 2. امسح الباركود من الرابط أعلاه، أو اربط برقم الهاتف\n` +
      `│\n` +
      `│ ⚡ شغال بنموذج: *Gemini 3.8 Live Extended Thinking*\n` +
      `│ 🗣️ نفس شخصية استرو المصرية الجدعة!\n` +
      `╰─────────────────────────╯`;

    await sendText(sock, targetJid, msg);
  }
};
