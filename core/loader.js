import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARABIC_ALIASES, normalizeArabic } from './arabic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, '..', 'commands');

let globalCommands = new Map();
let globalCategories = new Map();

export function getCommandsRegistry() {
  return { commands: globalCommands, categories: globalCategories };
}

/**
 * بيحمّل كل الأوامر من commands/<قسم>/<أمر>.js — كل ملف بيعمل export default
 * فيه name + execute() على الأقل. الملفات اللي بتبدأ بـ _ (هيلبرز/قوالب) بتتخطى.
 *
 * بيرجع: { commands, categories, errors, collisions } —
 * errors وcollisions لازم يتعرضوا في الإقلاع (connection.js) عشان التعارض
 * مايحصلش بصمت.
 */
export async function loadCommands() {
  const commands = new Map();   // الاسم والبدائل → الأمر
  const categories = new Map(); // الفئة → قائمة الأوامر
  const collisions = [];
  const errors = [];
  let shadowedCount = 0; // أوامر كل أسمائها متاخدة — مش هتنفذ أبدًا

  const folders = readdirSync(COMMANDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const folder of folders) {
    if (!categories.has(folder)) categories.set(folder, []);
    const catDir = join(COMMANDS_DIR, folder);

    for (const file of readdirSync(catDir)) {
      if (!file.endsWith('.js') || file.startsWith('_')) continue;
      const path = join(catDir, file);
      try {
        const mod = await import(pathToFileURL(path).href);
        const cmd = mod.default ?? mod;
        if (!cmd || typeof cmd !== 'object' || !cmd.name || typeof cmd.execute !== 'function') {
          throw new Error('لازم export default فيه name و execute()');
        }
        if (cmd.aliases !== undefined && !Array.isArray(cmd.aliases)) {
          throw new Error('aliases لازم تكون array من الأسماء');
        }
        cmd.category = folder;
        cmd.file = path;
        if (!register(commands, categories, cmd, collisions)) shadowedCount++;
      } catch (err) {
        errors.push(`${folder}/${file} → ${err.message}`);
      }
    }
  }

  globalCommands = commands;
  globalCategories = categories;

  return { commands, categories, errors, collisions, shadowedCount };
}

// بنسجّل الاسم الأساسي + aliases + الصيغ العربية من القاموس + نسخها المُطبَّعة
// التعارض ميتسكتش: بيتسجل في collisions والاسم الأول هو اللي يكسب.
// الأمر بيدخل قايمة فئته بس لو كسب مفتاح واحد على الأقل — اللي اتظلل بالكامل
// كان بيفضل ظاهر في المنيو وهو مش بيتنفذ خالص (بترجع false هنا).
function register(commands, categories, cmd, collisions) {
  const arabicFromDict = ARABIC_ALIASES[cmd.name] ?? [];
  const names = [cmd.name, ...(cmd.aliases ?? []), ...arabicFromDict].filter(
    (n) => typeof n === 'string' && n.trim(),
  );

  // إضافة النسخة العربية المُطبَّعة من كل اسم (عشان "الاغنيه" = "اغنية")
  const all = [...names];
  for (const n of names) {
    const norm = normalizeArabic(n);
    if (norm && norm !== n) all.push(norm);
  }

  cmd.allNames = all;
  let owned = false;
  for (const name of all) {
    const key = name.toLowerCase();
    const existing = commands.get(key);
    if (existing && existing !== cmd) {
      collisions.push({ alias: key, winner: existing.name, shadowed: cmd.name });
      continue; // نحافظ على السلوك السابق لكن ما نخفيش التعارض عن الفحوص.
    }
    if (!existing) {
      commands.set(key, cmd);
      owned = true;
    }
  }
  if (owned) categories.get(cmd.category).push(cmd);
  return owned;
}
