import fs from 'node:fs';
import { join, relative, dirname } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

let pool = null;
let dbInitialized = false;
let initPromise = null;

/**
 * هل تم إعداد عنوان قاعدة البيانات في البيئة؟
 */
export function isDbConfigured() {
  return !!process.env.DATABASE_URL;
}

/**
 * هل الاتصال بقاعدة البيانات حي وشغال حاليًا؟
 */
export function isDbConnected() {
  return dbInitialized && !!pool;
}

/**
 * إنشاء أو استرجاع مجمع الاتصالات بـ PostgreSQL بأمان
 */
export async function getDbPool() {
  if (!isDbConfigured()) return null;
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  // في شبكة CranL الداخلية (host: nova-db-xxx:5432) الاتصال مباشر
  // لو خارجي أو طالب SSL بنفعل rejectUnauthorized: false
  const needsSsl = connectionString.includes('sslmode=require') ||
    process.env.PGSSLMODE === 'require' ||
    process.env.DATABASE_SSL === 'true';

  try {
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

    pool.on('error', (err) => {
      console.warn('⚠️ تنبيه من مجمع اتصالات PostgreSQL:', err.message?.slice(0, 100));
    });

    return pool;
  } catch (err) {
    console.error('❌ تعذر إنشاء مجمع اتصالات PostgreSQL:', err.message);
    return null;
  }
}

/**
 * فحص الاتصال وإنشاء الجداول تلقائيًا لو لم تكن موجودة
 */
export async function initDatabase() {
  if (!isDbConfigured()) return false;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const p = await getDbPool();
      if (!p) return false;

      // 1. جدول حفظ ملفات الجلسة (creds + pre-keys + app-state)
      // 2. جدول حفظ بيانات البوت (db.json: users, groups, economy, reminders)
      await p.query(`
        CREATE TABLE IF NOT EXISTS session_storage (
          key VARCHAR(512) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS bot_kv (
          key VARCHAR(255) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      dbInitialized = true;
      console.log('🐘 تم الاتصال بقاعدة بيانات PostgreSQL بنجاح — تم تجهيز جداول حفظ الجلسة والبيانات');
      return true;
    } catch (err) {
      console.warn('⚠️ تعذر إعداد جداول PostgreSQL (سيستمر البوت بالتخزين المحلي):', err.message?.slice(0, 120));
      dbInitialized = false;
      return false;
    }
  })();

  return initPromise;
}

/**
 * استخراج كل الملفات الفعلية داخل مجلد الجلسة (مع استثناء ملفات الـ data والـ qr والـ tmp)
 */
function getAllSessionFiles(dir, baseDir = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (rel === 'data' || rel.startsWith('data/') || rel === 'qr.txt' || rel.endsWith('.tmp') || rel.endsWith('.bak')) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...getAllSessionFiles(full, baseDir));
    } else if (entry.isFile()) {
      files.push({ rel, full });
    }
  }
  return files;
}

/**
 * استرجاع ملفات الجلسة من قاعدة البيانات وكتابتها على القرص المحلي عند بدء التشغيل
 */
export async function restoreSessionFromDb(sessionDir) {
  if (!isDbConfigured()) return 0;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return 0;

    const res = await pool.query('SELECT key, value FROM session_storage');
    if (!res.rows || !res.rows.length) {
      console.log('ℹ️ لم يتم العثور على جلسة سابقة في قاعدة البيانات — بانتظار مسح الـ QR الأول');
      return 0;
    }

    fs.mkdirSync(sessionDir, { recursive: true });
    let count = 0;
    for (const row of res.rows) {
      if (!row.key || typeof row.value !== 'string') continue;
      const target = join(sessionDir, row.key);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.writeFileSync(target, row.value, 'utf8');
      count++;
    }

    console.log(`📦 تم استرجاع ${count} ملف لجلسة واتساب من PostgreSQL إلى ${sessionDir}`);
    return count;
  } catch (err) {
    console.error('⚠️ خطأ أثناء استرجاع الجلسة من PostgreSQL:', err.message?.slice(0, 100));
    return 0;
  }
}

/**
 * مزامنة وحفظ جميع ملفات الجلسة المحلية إلى قاعدة البيانات السحابية
 */
export async function syncSessionToDb(sessionDir) {
  if (!isDbConfigured()) return 0;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return 0;

    const files = getAllSessionFiles(sessionDir);
    if (!files.length) return 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of files) {
        let content;
        try {
          content = fs.readFileSync(f.full, 'utf8');
        } catch {
          continue;
        }
        await client.query(
          `INSERT INTO session_storage (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [f.rel, content]
        );
      }
      await client.query('COMMIT');
      return files.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('⚠️ فشل مزامنة ملفات الجلسة مع PostgreSQL:', err.message?.slice(0, 100));
    return 0;
  }
}

let syncTimer = null;
/**
 * جدولة مزامنة مؤجلة للجلسة لتجميع عمليات الكتابة السريعة
 */
export function scheduleSessionSync(sessionDir, delayMs = 2000) {
  if (!isDbConfigured()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    const count = await syncSessionToDb(sessionDir);
    if (count > 0) {
      console.log(`💾 تم حفظ ومزامنة ${count} ملف من الجلسة في PostgreSQL`);
    }
  }, delayMs);
}

/**
 * مسح جميع ملفات الجلسة من قاعدة البيانات عند تسجيل الخروج
 */
export async function clearSessionFromDb() {
  if (!isDbConfigured()) return;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return;
    await pool.query('DELETE FROM session_storage');
    console.log('🧹 تم مسح الجلسة من قاعدة بيانات PostgreSQL');
  } catch (err) {
    console.error('⚠️ فشل مسح الجلسة من PostgreSQL:', err.message?.slice(0, 100));
  }
}

/**
 * تصدير الجلسة الحالية ككائن JSON (للاستخدام في النسخ الاحتياطي)
 */
export async function exportSessionDump(sessionDir) {
  const result = {};
  // 1. لو في ملفات محلية نجمعها
  if (fs.existsSync(sessionDir)) {
    const files = getAllSessionFiles(sessionDir);
    for (const f of files) {
      try {
        result[f.rel] = fs.readFileSync(f.full, 'utf8');
      } catch {}
    }
  }
  // 2. لو مفيش محلي بس في قاعدة بيانات
  if (Object.keys(result).length === 0 && isDbConfigured() && pool) {
    try {
      const res = await pool.query('SELECT key, value FROM session_storage');
      for (const row of res.rows) {
        result[row.key] = row.value;
      }
    } catch {}
  }
  return result;
}

/**
 * استيراد نسخة احتياطية للجلسة وحفظها محلياً وفي قاعدة البيانات
 */
export async function importSessionDump(sessionDir, dumpObj) {
  if (!dumpObj || typeof dumpObj !== 'object') return 0;
  fs.mkdirSync(sessionDir, { recursive: true });
  let count = 0;
  for (const [key, value] of Object.entries(dumpObj)) {
    if (typeof value !== 'string') continue;
    const target = join(sessionDir, key);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, value, 'utf8');
    count++;
  }
  if (isDbConfigured()) {
    await syncSessionToDb(sessionDir);
  }
  return count;
}

/**
 * استرجاع بيانات الـ KV (قاعدة بيانات البوت db.json) من PostgreSQL
 */
export async function restoreKvFromDb() {
  if (!isDbConfigured()) return null;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return null;

    const res = await pool.query('SELECT key, value FROM bot_kv');
    if (!res.rows || !res.rows.length) return null;

    const out = {};
    for (const row of res.rows) {
      out[row.key] = row.value;
    }
    console.log(`🧠 تم استرجاع بيانات البوت (db.json) من PostgreSQL (${Object.keys(out).length} أقسام)`);
    return out;
  } catch (err) {
    console.warn('⚠️ تعذر استرجاع KV من PostgreSQL:', err.message?.slice(0, 100));
    return null;
  }
}

/**
 * حفظ كل بيانات البوت إلى PostgreSQL
 */
export async function saveAllKvToDb(dataObj) {
  if (!isDbConfigured() || !dataObj || typeof dataObj !== 'object') return;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(dataObj)) {
        await client.query(
          `INSERT INTO bot_kv (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, JSON.stringify(v)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('⚠️ فشل حفظ KV في PostgreSQL:', err.message?.slice(0, 100));
  }
}

/**
 * حفظ مفتاح محدد وبياناته في PostgreSQL مباشرة (Atomic Upsert)
 */
export async function saveKeyToDb(key, value) {
  if (!isDbConfigured() || !key) return false;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return false;
    await pool.query(
      `INSERT INTO bot_kv (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    return true;
  } catch (err) {
    console.warn(`⚠️ فشل حفظ المفتاح ${key} في PostgreSQL:`, err.message?.slice(0, 80));
    return false;
  }
}

/**
 * حذف مفتاح من جدول bot_kv في PostgreSQL
 */
export async function deleteKeyFromDb(key) {
  if (!isDbConfigured() || !key) return false;
  try {
    const ready = await initDatabase();
    if (!ready || !pool) return false;
    await pool.query('DELETE FROM bot_kv WHERE key = $1', [key]);
    return true;
  } catch (err) {
    console.warn(`⚠️ فشل حذف المفتاح ${key} من PostgreSQL:`, err.message?.slice(0, 80));
    return false;
  }
}

/**
 * جلب إحصائيات قاعدة البيانات السحابية (للوحة التحكم وفحص الصحة)
 */
export async function getDbStats() {
  if (!isDbConfigured()) {
    return { configured: false, connected: false };
  }
  try {
    const ready = await initDatabase();
    if (!ready || !pool) {
      return { configured: true, connected: false };
    }
    const t0 = Date.now();
    const [sessRes, kvRes, sizeRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM session_storage'),
      pool.query('SELECT COUNT(*)::int AS count FROM bot_kv'),
      pool.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS size").catch(() => ({ rows: [{ size: 'N/A' }] })),
    ]);
    const pingMs = Date.now() - t0;
    return {
      configured: true,
      connected: true,
      pingMs,
      sessionFilesCount: sessRes.rows[0]?.count || 0,
      kvKeysCount: kvRes.rows[0]?.count || 0,
      dbSize: sizeRes.rows[0]?.size || 'N/A',
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err.message?.slice(0, 100),
    };
  }
}
