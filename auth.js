import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gymFields, ownedGym } from './manual-gyms.js';
import { LISTING_PLAN } from './subscriptions.js';
const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const unavailable = 'El acceso con cuenta todavía no está disponible. Puedes seguir explorando como invitado.';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const result = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return result.length === expected.length && timingSafeEqual(result, expected);
}
const publicUser = user => ({ id: user.id, email: user.email, name: user.name, city: user.city, favorites: JSON.parse(user.favorites) });
function fail(status, message) { return Object.assign(new Error(message), { status }); }
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Envía los datos en formato JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw fail(413, 'Los datos enviados son demasiado grandes.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail(400, 'No pudimos leer los datos enviados.'); }
}
export function createAuth({ store, production = false, publicOrigin, rateLimit = 30 } = {}) {
  const cookieName = production ? '__Host-gymhora_session' : 'gymhora_session';
  const attempts = new Map();
  const tokenFrom = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  function cookie(res, token, age) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`);
  }
  async function userFrom(req) {
    const token = tokenFrom(req);
    return /^[a-f0-9]{64}$/.test(token) ? store.sessionUser(hashToken(token)) : null;
  }
  function checkRate(req, email) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    // Render terminates TLS and appends the client address to X-Forwarded-For.
    const ip = production ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim() : req.socket.remoteAddress;
    for (const key of ['ip:' + ip, 'email:' + email]) {
      const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      if (++entry.count > rateLimit) throw fail(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.');
      attempts.set(key, entry);
    }
  }
  let dummyPasswordHash;
  async function newSession(req, res, user) {
    const token = randomBytes(32).toString('hex');
    await store.createSession(hashToken(token), user.id, Date.now() + SESSION_SECONDS * 1000);
    const previous = tokenFrom(req);
    if (previous) await store.deleteSession(hashToken(previous));
    cookie(res, token, SESSION_SECONDS);
  }
  return async (req, res, path, json) => {
    if (!path.startsWith('/api/auth/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!store) {
        json(res, path === '/api/auth/session' && req.method === 'GET' ? 200 : 503, { available: false, user: null, error: unavailable });
        return true;
      }
      if (req.method === 'GET' && path === '/api/auth/session') {
        const user = await userFrom(req);
        json(res, 200, { available: true, user: user ? publicUser(user) : null });
        return true;
      }
      if (req.method === 'GET' && path === '/api/auth/gyms') {
        const user = await userFrom(req);
        if (!user) throw fail(401, 'Inicia sesión para ver tus gimnasios.');
        json(res, 200, { gyms: (await store.listOwnedGyms(user.id)).map(ownedGym), plan: LISTING_PLAN });
        return true;
      }
      if (req.method !== 'POST') throw fail(405, 'Método no permitido.');
      const expectedOrigin = publicOrigin || `${production ? 'https' : 'http'}://${req.headers.host}`;
      if (req.headers.origin !== expectedOrigin) throw fail(403, 'La solicitud no pertenece a esta aplicación. Recarga la página.');
      const body = await readJSON(req);
      if (path === '/api/auth/register' || path === '/api/auth/login') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = body.password;
        checkRate(req, email.slice(0, 254));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw fail(400, 'Introduce un correo electrónico válido.');
        if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw fail(400, 'La contraseña debe tener entre 10 y 128 caracteres.');
        let user;
        if (path.endsWith('/register')) {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (name.length < 2 || name.length > 80) throw fail(400, 'El nombre debe tener entre 2 y 80 caracteres.');
          try {
            user = await store.createUser({ id: randomUUID(), email, name, password_hash: await hashPassword(password) });
          } catch (error) {
            if (error.code === '23505' || error.code?.startsWith('SQLITE_CONSTRAINT') || error.errcode === 2067) throw fail(409, 'No se pudo crear la cuenta con ese correo. Si ya tienes una cuenta, inicia sesión.');
            throw error;
          }
        } else {
          user = await store.userByEmail(email);
          // Perform the same password work for an unknown email.
          dummyPasswordHash ||= hashPassword(randomBytes(32).toString('hex'));
          const matches = await checkPassword(password, user?.password_hash || await dummyPasswordHash);
          if (!matches || !user) throw fail(401, 'Correo o contraseña incorrectos.');
        }
        await newSession(req, res, user);
        json(res, path.endsWith('/register') ? 201 : 200, { user: publicUser(user) });
      } else if (path === '/api/auth/logout') {
        const token = tokenFrom(req);
        if (token) await store.deleteSession(hashToken(token));
        cookie(res, '', 0);
        json(res, 200, { user: null });
      } else if (['/api/auth/gyms/create', '/api/auth/gyms/update', '/api/auth/gyms/delete'].includes(path)) {
        const user = await userFrom(req);
        if (!user) throw fail(401, 'Inicia sesión para administrar tus gimnasios.');
        checkRate(req, 'gyms:' + user.id);
        if (path.endsWith('/delete')) {
          if (typeof body.id !== 'string' || body.id.length > 160) throw fail(400, 'Selecciona un gimnasio válido.');
          if (!await store.deleteGym(body.id, user.id)) throw fail(404, 'No encontramos ese gimnasio entre los tuyos.');
          json(res, 200, { deleted: true });
        } else {
          const fields = gymFields(body);
          if (!fields) throw fail(400, 'Revisa el nombre, la ciudad, el sector y el nivel de ocupación.');
          let gym;
          if (path.endsWith('/create')) {
            if (body.acceptTrial !== true) throw fail(400, 'Acepta las condiciones de la prueba de 7 días y del plan de RD$1,599 al mes por gimnasio.');
            gym = await store.createGym('community-' + randomUUID(), user.id, fields);
            if (!gym) throw fail(409, 'Puedes administrar hasta 20 gimnasios en tu cuenta.');
          } else {
            if (typeof body.id !== 'string' || body.id.length > 160) throw fail(400, 'Selecciona un gimnasio válido.');
            gym = await store.updateGym(body.id, user.id, fields);
            if (!gym) throw fail(404, 'No encontramos ese gimnasio entre los tuyos.');
          }
          // Reload joined access fields after editing; never accept payment or
          // trial dates from the browser, including forged "paid" flags.
          const joined = (await store.listOwnedGyms(user.id)).find(row => row.id === gym.id);
          json(res, path.endsWith('/create') ? 201 : 200, { gym: ownedGym(joined), plan: LISTING_PLAN });
        }
      } else if (path === '/api/auth/profile' || path === '/api/auth/favorites') {
        const user = await userFrom(req);
        if (!user) throw fail(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
        let updated;
        if (path.endsWith('/profile')) {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const city = typeof body.city === 'string' ? body.city.trim() : '';
          if (name.length < 2 || name.length > 80 || city.length > 80) throw fail(400, 'Revisa el nombre (2 a 80 caracteres) y la ciudad (máximo 80).');
          updated = await store.updateProfile(user.id, name, city);
        } else {
          if (!Array.isArray(body.favorites) || body.favorites.length > 1000 || body.favorites.some(id => typeof id !== 'string' || !id.trim() || id.length > 160)) throw fail(400, 'La lista de favoritos no es válida.');
          updated = await store.updateFavorites(user.id, [...new Set(body.favorites)]);
        }
        json(res, 200, { user: publicUser(updated) });
      } else throw fail(404, 'No encontrado.');
    } catch (error) {
      if (error.status === 429) res.setHeader('Retry-After', '900');
      json(res, error.status || 503, { error: error.status ? error.message : 'No pudimos acceder a tu cuenta. Intenta de nuevo en unos momentos.' });
    }
    return true;
  };
}
