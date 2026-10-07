// تحويل مدة بالملي ثانية لنص مقروء: "يوم و3 ساعة و5 دقيقة و10 ثانية"
export function runtime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d} يوم`);
  if (h) parts.push(`${h} ساعة`);
  if (m) parts.push(`${m} دقيقة`);
  parts.push(`${sec} ثانية`);
  return parts.join(' و');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 👑 هل الموزع مالك للبوت؟
// ⚠️ كان بيقارن m.sender بس — ورسايل 2026 بتيجي بهوية LID في participant
// (handler.js بيحط participant في sender)، فأرقام الـ LID عمرها ما تطابق
// رقم المالك الدولي وكل أوامر المالك كانت بتترد «للمالك بس».
// دلوقتي بناخد كل صيغ الهوية المتاحة: المرسل + الصيغة البديلة
// (senderAlt = remoteJidAlt في الخاص / participantAlt في الجروب — فيها الرقم الحقيقي).
export function isOwner(m, config) {
  if (!config.owners?.length) return false;
  const candidates = [
    m?.sender,
    m?.senderAlt,
    m?.identityKey,
    m?.jid,
    m?.msg?.key?.remoteJidAlt,
    m?.msg?.key?.participantAlt,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const digits = String(c).split(':')[0].split('@')[0].replace(/\D/g, '');
    if (digits && config.owners.some((o) => digits === String(o).replace(/\D/g, ''))) return true;
  }
  return false;
}
