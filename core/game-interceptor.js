import { db } from './db.js';
import { normalizeArabic } from './arabic.js';

// استيراد أوامر الألعاب لمعالجة حركات اللاعبين التلقائية بدون بادئة
import xoCmd from '../commands/games/xo.js';
import duelCmd from '../commands/games/duel.js';
import mathCmd from '../commands/games/math.js';
import guessCmd from '../commands/games/guess.js';
import hangCmd from '../commands/games/hang.js';
import quizCmd from '../commands/games/quiz.js';
import colorCmd from '../commands/games/color.js';
import guesswhoCmd from '../commands/games/guesswho.js';
import raceCmd from '../commands/games/race.js';
import rpsCmd from '../commands/games/rps.js';
import scrambleCmd from '../commands/games/scramble.js';
import flagsCmd from '../commands/games/flags.js';

const ARABIC_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوىيءأإؤئةى';
const QUIZ_LETTERS = { 'أ': 0, 'ا': 0, '1': 0, '١': 0, 'ب': 1, '2': 1, '٢': 1, 'ج': 2, '3': 2, '٣': 2, 'د': 3, '4': 3, '٤': 3 };
const RPS_WORDS = ['حجر', 'ورقة', 'مقص', 'rock', 'paper', 'scissors', '✊', '✋', '✌️'];

/**
 * 🎮 معالج واعتراض حركات الألعاب الذكي (In-Game Input Interceptor)
 * يسمح للاعبين بالرد المباشر في الشات بالأرقام أو الإجابات دون الحاجة لكتابة بادئة الأمر!
 * @param {object} sock - اتصال Baileys
 * @param {object} m - كائن الرسالة
 * @returns {Promise<boolean>} true إذا تم اعتراض ومعالجة حركة لعبة، false للمحادثة العادية
 */
export async function interceptGameInput(sock, m) {
  if (!m || !m.body) return false;
  const raw = m.body.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const norm = normalizeArabic(lower);
  const me = m.identityKey ?? m.sender;

  // أ) أوامر الإيقاف والاستسلام العامة لألعاب الألواح والمسابقات
  if (['stop', 'انسحب', 'استسلم', 'الغاء', 'إلغاء', 'وقف', 'خروج'].includes(norm)) {
    const allXo = db.get('xo', {});
    if (allXo[m.jid]) {
      await xoCmd.execute(sock, m, ['stop']);
      return true;
    }
    const allDuels = db.get('duels', {});
    if (allDuels[m.jid]) {
      await duelCmd.execute(sock, m, ['cancel']);
      return true;
    }
    const allQuiz = db.get('quiz', {});
    if (allQuiz[m.jid]) {
      await quizCmd.execute(sock, m, ['stop']);
      return true;
    }
    const allMath = db.get('math', {});
    if (allMath[m.jid]) {
      await mathCmd.execute(sock, m, ['giveup']);
      return true;
    }
    const allHang = db.get('hang', {});
    if (allHang[m.jid]) {
      await hangCmd.execute(sock, m, ['giveup']);
      return true;
    }
    const allScramble = db.get('scramble', {});
    if (allScramble[m.jid]) {
      await scrambleCmd.execute(sock, m, ['giveup']);
      return true;
    }
    const allFlags = db.get('flags', {});
    if (allFlags[m.jid]) {
      await flagsCmd.execute(sock, m, ['giveup']);
      return true;
    }
    const allGuess = db.get('guess', {});
    const gk = `${m.jid}::${me}` magic_separator_avoid
  }
}
