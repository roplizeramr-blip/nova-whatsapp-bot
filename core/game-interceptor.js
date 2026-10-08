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
    const gk = `${m.jid}::${me}`;
    if (allGuess[gk]) {
      await guessCmd.execute(sock, m, ['surrender']);
      return true;
    }
    const allGw = db.get('guessWho', {});
    if (allGw[m.jid]) {
      await guesswhoCmd.execute(sock, m, ['cancel']);
      return true;
    }
    const allRace = db.get('race', {});
    if (allRace[m.jid]) {
      await raceCmd.execute(sock, m, ['stop']);
      return true;
    }
  }

  // 1️⃣ لعبة إكس-أو (XO ضد البوت أو المبارزة PVP)
  // التحقق من إدخال رقم المربع 1-9 أو p1-p9
  if (/^[1-9]$/.test(raw) || /^p[1-9]$/i.test(raw) || /^[١-٩]$/.test(raw)) {
    let num = raw.replace(/^p/i, '');
    const arDigits = { '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
    if (arDigits[num]) num = arDigits[num];

    // أ) التحقق من وجود مبارزة جماعية نشطة (Duel PVP)
    const allDuels = db.get('duels', {});
    const duel = allDuels[m.jid];
    if (duel && duel.stage === 'playing') {
      const currentPlayer = duel.turn === 'X' ? duel.pX : duel.pO;
      if (me === currentPlayer || m.sender === currentPlayer || me?.includes(String(currentPlayer).split('@')[0])) {
        await duelCmd.execute(sock, m, [`mv-${num}`]);
        return true;
      }
    }

    // ب) التحقق من وجود لعبة XO عادية (vs Bot)
    const allXo = db.get('xo', {});
    const xo = allXo[m.jid];
    if (xo && xo.board) {
      if (xo.player === me || xo.player === m.sender || !xo.player) {
        await xoCmd.execute(sock, m, [num]);
        return true;
      }
    }
  }

  // 2️⃣ لعبة المسابقة الثقافية (Quiz)
  const allQuiz = db.get('quiz', {});
  const quizGame = allQuiz[m.jid];
  if (quizGame && quizGame.q !== undefined && quizGame.order) {
    // إجابة بالحرف أو الرقم (أ, ب, ج, د أو 1, 2, 3, 4)
    if (QUIZ_LETTERS[raw] !== undefined) {
      const shownPos = QUIZ_LETTERS[raw];
      await quizCmd.execute(sock, m, [`ans-${quizGame.q}-${shownPos}`]);
      return true;
    }
    // إجابة بنص الخيار نفسه
    if (quizGame.optionsText && Array.isArray(quizGame.optionsText)) {
      const matchedIdx = quizGame.optionsText.findIndex((opt) => normalizeArabic(opt.toLowerCase()) === norm);
      if (matchedIdx !== -1) {
        await quizCmd.execute(sock, m, [`ans-${quizGame.q}-${matchedIdx}`]);
        return true;
      }
    }
  }

  // 3️⃣ لعبة ترتيب الحروف المبعثرة (Scramble)
  const allScramble = db.get('scramble', {});
  const scrambleGame = allScramble[m.jid];
  if (scrambleGame && scrambleGame.word && (Date.now() - (scrambleGame.at || 0) <= 60000)) {
    if (raw.length >= 2 && raw.length <= 20 && !/[؟?]/u.test(raw)) {
      const cleanGuess = raw.replace(/\s+/g, '');
      const cleanTarget = scrambleGame.word.replace(/\s+/g, '');
      if (normalizeArabic(cleanGuess) === normalizeArabic(cleanTarget)) {
        await scrambleCmd.execute(sock, m, [raw]);
        return true;
      }
    }
  }

  // 4️⃣ لعبة خمن علم الدولة (Flags)
  const allFlags = db.get('flags', {});
  const flagsGame = allFlags[m.jid];
  if (flagsGame && flagsGame.country && (Date.now() - (flagsGame.at || 0) <= 60000)) {
    if (norm === 'تلميح' || norm === 'hint') {
      await flagsCmd.execute(sock, m, ['hint']);
      return true;
    }
    if (raw.length >= 2 && raw.length <= 25 && !/[؟?]/u.test(raw)) {
      const cleanGuess = raw.replace(/\s+/g, '');
      const cleanTarget = flagsGame.country.replace(/\s+/g, '');
      if (normalizeArabic(cleanGuess) === normalizeArabic(cleanTarget) || norm.includes(normalizeArabic(flagsGame.country))) {
        await flagsCmd.execute(sock, m, [raw]);
        return true;
      }
    }
  }

  // 5️⃣ تحدي الرياضيات (Math Challenge)
  const allMath = db.get('math', {});
  const mathGame = allMath[m.jid];
  if (mathGame && mathGame.answer !== undefined && (Date.now() - (mathGame.at || 0) <= 60000)) {
    if (/^-?\d+$/.test(raw)) {
      await mathCmd.execute(sock, m, [raw]);
      return true;
    }
  }

  // 6️⃣ لعبة التخمين (Guess the Number 1..50)
  const allGuess = db.get('guess', {});
  const guessKey = `${m.jid}::${me}`;
  const guessGame = allGuess[guessKey];
  if (guessGame && guessGame.left > 0) {
    if (norm === 'تلميح' || norm === 'hint') {
      await guessCmd.execute(sock, m, ['hint']);
      return true;
    }
    if (/^\d+$/.test(raw)) {
      const val = Number(raw);
      if (val >= 1 && val <= 50) {
        await guessCmd.execute(sock, m, [raw]);
        return true;
      }
    }
  }

  // 7️⃣ لعبة المشنقة والكلمة المخفية (Hangman)
  const allHang = db.get('hang', {});
  const hangGame = allHang[m.jid];
  if (hangGame && hangGame.word) {
    // حرف عربي واحد
    if (raw.length === 1 && ARABIC_LETTERS.includes(raw)) {
      await hangCmd.execute(sock, m, [raw]);
      return true;
    }
    // تخمين الكلمة كاملة مباشرة!
    if (raw.length >= 2 && raw.length <= 15 && /^[\u0600-\u06FF\s]+$/.test(raw)) {
      const cleanGuess = raw.replace(/\s+/g, '');
      const cleanTarget = hangGame.word.replace(/\s+/g, '');
      if (normalizeArabic(cleanGuess) === normalizeArabic(cleanTarget)) {
        await hangCmd.execute(sock, m, [raw]);
        return true;
      }
    }
  }

  // 8️⃣ لعبة حجر ورقة مقص (RPS)
  if (RPS_WORDS.includes(norm)) {
    await rpsCmd.execute(sock, m, [raw]);
    return true;
  }

  // 9️⃣ لعبة الألوان (Color Game)
  const allColors = db.get('colorGames', {});
  const colorKey = `${m.jid}::${me}`;
  const colorGame = allColors[colorKey];
  if (colorGame && (Date.now() - (colorGame.at || 0) <= 120000)) {
    const knownColors = ['احمر', 'ازرق', 'اخضر', 'اصفر', 'برتقالي', 'بنفسجي', 'بني', 'اسود'];
    if (knownColors.some((c) => norm.includes(c))) {
      await colorCmd.execute(sock, m, [raw]);
      return true;
    }
  }

  // 🔟 لعبة من هو / خمن الشخصية (Guess Who)
  const allGw = db.get('guessWho', {});
  const gwGame = allGw[m.jid];
  if (gwGame && gwGame.who && (Date.now() - (gwGame.at || 0) <= 15 * 60 * 1000)) {
    if (norm === 'تلميح' || norm === 'hint') {
      await guesswhoCmd.execute(sock, m, ['hint']);
      return true;
    }
    if (raw.length >= 3 && raw.length <= 30 && !/[؟?]/u.test(raw) && !/^(ازيك|اهلا|صباح|مساء|هاي|سلام)/i.test(norm)) {
      await guesswhoCmd.execute(sock, m, ['guess', raw]);
      return true;
    }
  }

  // 1️⃣1️⃣ سباق السرعة (Speed Race)
  const allRace = db.get('race', {});
  const raceGame = allRace[m.jid];
  if (raceGame && (Date.now() - (raceGame.at || 0) <= 60000)) {
    if (/^\d+$/.test(raw)) {
      await raceCmd.execute(sock, m, [raw]);
      return true;
    }
  }

  return false;
}
