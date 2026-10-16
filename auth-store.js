import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
`;

// Both adapters use bound parameters, and the same schema and account behavior.
export async function createStore({ databaseUrl = process.env.DATABASE_URL, sqlitePath = process.env.SQLITE_PATH || '.local/accounts.sqlite', production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' } = {}) {
  let query, close;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000, query_timeout: 8000 });
    try { await pool.query(schema); } catch (error) { await pool.end(); throw error; }
    query = async (sql, values = []) => (await pool.query(sql, values)).rows;
    close = () => pool.end();
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
  }
  return {
    close,
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
