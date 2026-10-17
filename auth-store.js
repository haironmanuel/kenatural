import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TRIAL_MS } from './subscriptions.js';
import { reportDays, reportTime } from './hourly-reports.js';
import { isDisallowedGymName, REMOVAL_NOTICE } from './name-policy.js';

const schema = `
CREATE TABLE IF NOT EXISTS gymhora_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  favorites TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS gymhora_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES gymhora_users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS gymhora_sessions_user ON gymhora_sessions(user_id);
CREATE TABLE IF NOT EXISTS gymhora_manual_gyms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES gymhora_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('quiet', 'medium', 'busy')),
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS gymhora_manual_gyms_owner ON gymhora_manual_gyms(owner_id);
CREATE INDEX IF NOT EXISTS gymhora_manual_gyms_updated ON gymhora_manual_gyms(updated_at);
CREATE TABLE IF NOT EXISTS gymhora_publisher_trials (
  owner_id TEXT PRIMARY KEY REFERENCES gymhora_users(id) ON DELETE CASCADE,
  started_at BIGINT NOT NULL,
  trial_ends_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS gymhora_listing_subscriptions (
  gym_id TEXT PRIMARY KEY REFERENCES gymhora_manual_gyms(id) ON DELETE CASCADE,
  paid_until BIGINT NOT NULL,
  verified_payment_reference TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS gymhora_hourly_reports (
  gym_id TEXT NOT NULL REFERENCES gymhora_manual_gyms(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  report_hour INTEGER NOT NULL CHECK (report_hour BETWEEN 0 AND 23),
  status TEXT NOT NULL CHECK (status IN ('quiet', 'medium', 'busy')),
  reported_at BIGINT NOT NULL,
  PRIMARY KEY (gym_id, report_date, report_hour)
);
CREATE TABLE IF NOT EXISTS gymhora_account_notices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES gymhora_users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  acknowledged_at BIGINT
);
CREATE INDEX IF NOT EXISTS gymhora_account_notices_owner ON gymhora_account_notices(owner_id, acknowledged_at);
`;

// Both adapters use bound parameters, and the same schema and account behavior.
export async function createStore({ databaseUrl = process.env.DATABASE_URL, sqlitePath = process.env.SQLITE_PATH || '.local/accounts.sqlite', production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true', now = Date.now } = {}) {
  let query, close, transaction;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000, query_timeout: 8000 });
    try { await pool.query(schema); } catch (error) { await pool.end(); throw error; }
    query = async (sql, values = []) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
    transaction = async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(async (sql, values = []) => (await client.query(sql, values)).rows);
        await client.query('COMMIT'); return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
  } else {
    if (production) throw new Error('DATABASE_URL_REQUIRED');
    const { DatabaseSync } = await import('node:sqlite');
    if (sqlitePath !== ':memory:') await mkdir(dirname(resolve(sqlitePath)), { recursive: true });
    const db = new DatabaseSync(sqlitePath);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    db.exec(schema);
    query = async (sql, values = []) => {
      // SQLite binds positional ? parameters; PostgreSQL uses $1, $2, …
      const params = [];
      const adapted = sql.replace(/\$(\d+)/g, (_, n) => { params.push(values[Number(n) - 1]); return '?'; });
      return db.prepare(adapted).all(...params);
    };
    close = async () => db.close();
    // Only used during initialization, before this store is returned to any
    // requests; no other work can enter this SQLite transaction.
    transaction = async work => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = await work(query); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    };
  }
  // Existing publishers receive one trial at migration. ON CONFLICT preserves its
  // original deadline across redeploys, edits, and deletion/recreation of gyms.
  const migrationTime = now();
  async function recordReport(gymId, status, timestamp) {
    const { date, hour } = reportTime(timestamp);
    await query('INSERT INTO gymhora_hourly_reports (gym_id, report_date, report_hour, status, reported_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (gym_id, report_date, report_hour) DO UPDATE SET status = excluded.status, reported_at = excluded.reported_at WHERE excluded.reported_at >= gymhora_hourly_reports.reported_at', [gymId, date, hour, status, timestamp]);
    await query('DELETE FROM gymhora_hourly_reports WHERE gym_id = $1 AND report_date < $2', [gymId, reportDays(now()).at(-1)]);
  }
  try {
    const candidates = await query('SELECT id, owner_id, name FROM gymhora_manual_gyms');
    for (const gym of candidates.filter(g => isDisallowedGymName(g.name))) {
      await transaction(async tx => {
        // Exact original name + owner protects a gym renamed concurrently to
        // an allowed name. Deletion and its private notice commit together.
        const removed = await tx('DELETE FROM gymhora_manual_gyms WHERE id = $1 AND owner_id = $2 AND name = $3 RETURNING id', [gym.id, gym.owner_id, gym.name]);
        if (removed.length) await tx('INSERT INTO gymhora_account_notices (id, owner_id, message, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', ['name-policy:' + gym.id, gym.owner_id, REMOVAL_NOTICE, migrationTime]);
      });
    }
    await query('INSERT INTO gymhora_publisher_trials (owner_id, started_at, trial_ends_at) SELECT DISTINCT owner_id, CAST($1 AS BIGINT), CAST($2 AS BIGINT) FROM gymhora_manual_gyms WHERE 1 = 1 ON CONFLICT (owner_id) DO NOTHING', [migrationTime, migrationTime + TRIAL_MS]);
    // Seed only the latest report already saved for a legacy gym, never a
    // fabricated daily profile. Its original timestamp must remain intact.
    const legacy = await query('SELECT g.id, g.status, g.updated_at FROM gymhora_manual_gyms g WHERE NOT EXISTS (SELECT 1 FROM gymhora_hourly_reports r WHERE r.gym_id = g.id)');
    const earliest = reportDays(migrationTime).at(-1);
    for (const gym of legacy) if (reportTime(gym.updated_at).date >= earliest) await recordReport(gym.id, gym.status, Number(gym.updated_at));
    await query('DELETE FROM gymhora_hourly_reports WHERE report_date < $1', [earliest]);
  } catch (error) { await close(); throw error; }
  const ownedSQL = 'SELECT g.*, t.trial_ends_at, s.paid_until FROM gymhora_manual_gyms g LEFT JOIN gymhora_publisher_trials t ON t.owner_id = g.owner_id LEFT JOIN gymhora_listing_subscriptions s ON s.gym_id = g.id';
  async function withHistory(rows) {
    if (!rows.length) return rows;
    const days = reportDays(now());
    const placeholders = rows.map((_, i) => '$' + (i + 2)).join(',');
    const reports = await query(`SELECT gym_id, report_date, report_hour, status, reported_at FROM gymhora_hourly_reports WHERE report_date >= $1 AND gym_id IN (${placeholders}) ORDER BY report_date, report_hour`, [days.at(-1), ...rows.map(r => r.id)]);
    const grouped = new Map();
    for (const report of reports) {
      if (!grouped.has(report.gym_id)) grouped.set(report.gym_id, []);
      grouped.get(report.gym_id).push(report);
    }
    return rows.map(row => ({ ...row, hourly_reports: grouped.get(row.id) || [], history_days: days }));
  }
  return {
    close,
    listNotices: async ownerId => (await query('SELECT id, message, created_at FROM gymhora_account_notices WHERE owner_id = $1 AND acknowledged_at IS NULL ORDER BY created_at, id', [ownerId])).map(row => ({ id: row.id, message: row.message, createdAt: new Date(Number(row.created_at)).toISOString() })),
    acknowledgeNotice: async (id, ownerId) => (await query('UPDATE gymhora_account_notices SET acknowledged_at = $1 WHERE id = $2 AND owner_id = $3 AND acknowledged_at IS NULL RETURNING id', [now(), id, ownerId]))[0],
    listPublicGyms: async () => withHistory(await query(ownedSQL + ' WHERE COALESCE(t.trial_ends_at, 0) > $1 OR COALESCE(s.paid_until, 0) > $1 ORDER BY g.updated_at DESC, g.id LIMIT 1000', [now()])),
    listOwnedGyms: async id => withHistory(await query(ownedSQL + ' WHERE g.owner_id = $1 ORDER BY g.updated_at DESC, g.id', [id])),
    createGym: async (id, ownerId, fields) => {
      const start = now();
      await query('INSERT INTO gymhora_publisher_trials (owner_id, started_at, trial_ends_at) VALUES ($1, $2, $3) ON CONFLICT (owner_id) DO NOTHING', [ownerId, start, start + TRIAL_MS]);
      const gym = (await query('INSERT INTO gymhora_manual_gyms (id, owner_id, name, city, area, status, updated_at) SELECT $1, $2, $3, $4, $5, $6, $7 WHERE (SELECT COUNT(*) FROM gymhora_manual_gyms WHERE owner_id = $2) < 20 RETURNING *', [id, ownerId, fields.name, fields.city, fields.area, fields.status, start]))[0];
      if (!gym) return undefined;
      await recordReport(id, fields.status, start);
      return (await withHistory(await query(ownedSQL + ' WHERE g.id = $1 AND g.owner_id = $2', [id, ownerId])))[0];
    },
    updateGym: async (id, ownerId, fields) => {
      const timestamp = now();
      const gym = (await query('UPDATE gymhora_manual_gyms SET name = $1, city = $2, area = $3, status = $4, updated_at = $5 WHERE id = $6 AND owner_id = $7 RETURNING *', [fields.name, fields.city, fields.area, fields.status, timestamp, id, ownerId]))[0];
      if (gym) await recordReport(id, fields.status, timestamp);
      return gym;
    },
    deleteGym: async (id, ownerId) => (await query('DELETE FROM gymhora_manual_gyms WHERE id = $1 AND owner_id = $2 RETURNING id', [id, ownerId]))[0],
    userByEmail: async email => (await query('SELECT * FROM gymhora_users WHERE email = $1', [email]))[0],
    createUser: async user => (await query('INSERT INTO gymhora_users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING *', [user.id, user.email, user.name, user.password_hash]))[0],
    updateProfile: async (id, name, city) => (await query('UPDATE gymhora_users SET name = $1, city = $2 WHERE id = $3 RETURNING *', [name, city, id]))[0],
    updateFavorites: async (id, favorites) => (await query('UPDATE gymhora_users SET favorites = $1 WHERE id = $2 RETURNING *', [JSON.stringify(favorites), id]))[0],
    createSession: async (hash, userId, expiresAt) => {
      await query('DELETE FROM gymhora_sessions WHERE expires_at <= $1', [Date.now()]);
      await query('INSERT INTO gymhora_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hash, userId, expiresAt]);
    },
    sessionUser: async hash => (await query('SELECT u.* FROM gymhora_users u JOIN gymhora_sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > $2', [hash, Date.now()]))[0],
    deleteSession: hash => query('DELETE FROM gymhora_sessions WHERE token_hash = $1', [hash]),
  };
}
