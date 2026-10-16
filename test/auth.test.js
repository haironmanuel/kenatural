import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createStore } from '../auth-store.js';
import { createApplication } from '../server.js';

async function fixture(t, options = {}) {
  const store = options.disabled ? undefined : await createStore({ databaseUrl: '', sqlitePath: options.path || ':memory:', production: false });
  const app = createApplication({ store, production: options.production || false, publicOrigin: options.production ? 'https://example.test' : undefined, rateLimit: options.rateLimit });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await store?.close(); });
  async function call(path, body, cookie = '', origin = options.production ? 'https://example.test' : base) {
    const response = await fetch(base + '/api/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return { store, app, call };
}
const account = { name: 'Ana Pérez', email: 'ana@example.test', password: 'Una contraseña larga 2026' };
const register = f => f.call('register', account);

test('registro, sesión privada, contraseña protegida con hash y cookie HttpOnly', async t => {
  const f = await fixture(t);
  const registered = await register(f);
  assert.equal(registered.response.status, 201);
  assert.equal(registered.data.user.email, account.email);
  assert.equal(registered.data.user.password_hash, undefined);
  assert.match(registered.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal(registered.response.headers.get('cache-control'), 'no-store');
  const stored = await f.store.userByEmail(account.email);
  assert.notEqual(stored.password_hash, account.password);
  assert.match(stored.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.deepEqual((await f.call('session', undefined, registered.cookie)).data.user, registered.data.user);
  assert.equal((await f.call('session')).data.user, null);
});

test('login valida contraseña, normaliza correo y no identifica cuentas inexistentes', async t => {
  const f = await fixture(t); await register(f);
  const wrong = await f.call('login', { email: account.email, password: 'Contraseña incorrecta' });
  const absent = await f.call('login', { email: 'nadie@example.test', password: account.password });
  assert.equal(wrong.response.status, 401); assert.equal(absent.response.status, 401);
  assert.equal(wrong.data.error, absent.data.error);
  const valid = await f.call('login', { email: ' ANA@EXAMPLE.TEST ', password: account.password });
  assert.equal(valid.response.status, 200); assert.ok(valid.cookie);
});

test('validación de registro y duplicados sin crear cuentas adicionales', async t => {
  const f = await fixture(t);
  for (const patch of [{ password: 'corta' }, { email: 'invalido' }, { name: ' ' }]) {
    assert.equal((await f.call('register', { ...account, ...patch })).response.status, 400);
  }
  await register(f);
  assert.equal((await register(f)).response.status, 409);
});

test('perfiles y favoritos están aislados por usuario; no acepta campos de identidad', async t => {
  const f = await fixture(t);
  const ana = await register(f);
  const bob = await f.call('register', { ...account, name: 'Roberto', email: 'bob@example.test' });
  const update = await f.call('profile', { name: 'Ana actualizada', city: 'Santiago', id: bob.data.user.id, email: 'injected@example.test' }, ana.cookie);
  assert.equal(update.data.user.name, 'Ana actualizada'); assert.equal(update.data.user.email, account.email);
  const favorites = await f.call('favorites', { favorites: ['demo-1', 'demo-1', 'demo-3'], userId: bob.data.user.id }, ana.cookie);
  assert.deepEqual(favorites.data.user.favorites, ['demo-1', 'demo-3']);
  const other = await f.call('session', undefined, bob.cookie);
  assert.equal(other.data.user.name, 'Roberto'); assert.deepEqual(other.data.user.favorites, []);
  assert.equal((await f.call('profile', { name: 'Intruso', city: '' })).response.status, 401);
  assert.equal((await f.call('favorites', { favorites: ['demo-1'] })).response.status, 401);
  assert.equal((await f.call('favorites', { favorites: [123] }, ana.cookie)).response.status, 400);
});

test('cierre de sesión revoca el token y rechaza cookies manipuladas', async t => {
  const f = await fixture(t); const session = await register(f);
  assert.equal((await f.call('session', undefined, 'gymhora_session=alterado')).data.user, null);
  const logout = await f.call('logout', {}, session.cookie);
  assert.equal(logout.response.status, 200); assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.call('session', undefined, session.cookie)).data.user, null);
});

test('sesiones vencidas se rechazan y las sesiones se rotan al iniciar sesión', async t => {
  const f = await fixture(t); const first = await register(f);
  const next = await f.call('login', account, first.cookie);
  assert.notEqual(next.cookie, first.cookie);
  assert.equal((await f.call('session', undefined, first.cookie)).data.user, null);
  const token = 'a'.repeat(64);
  await f.store.createSession(createHash('sha256').update(token).digest('hex'), first.data.user.id, Date.now() - 1000);
  assert.equal((await f.call('session', undefined, 'gymhora_session=' + token)).data.user, null);
});

test('rechaza solicitudes de otro origen y limita intentos de autenticación', async t => {
  const f = await fixture(t, { rateLimit: 2 });
  assert.equal((await f.call('register', account, '', 'https://otro-sitio.test')).response.status, 403);
  await register(f);
  await f.call('login', { ...account, password: 'Otra contraseña distinta' });
  const limited = await f.call('login', account);
  assert.equal(limited.response.status, 429); assert.equal(limited.response.headers.get('retry-after'), '900');
});

test('producción requiere una base persistente y emite cookies Secure con prefijo __Host-', async t => {
  await assert.rejects(createStore({ databaseUrl: '', production: true }), /DATABASE_URL_REQUIRED/);
  const f = await fixture(t, { production: true }); const session = await register(f);
  assert.match(session.response.headers.get('set-cookie'), /^__Host-gymhora_session=.*; Secure$/);
  assert.equal((await f.call('session', undefined, session.cookie)).data.user.email, account.email);
});

test('sin base de datos se puede explorar, pero el registro no finge funcionar', async t => {
  const f = await fixture(t, { disabled: true });
  const status = await f.call('session'); assert.equal(status.data.available, false);
  assert.equal((await register(f)).response.status, 503);
  const address = f.app.address();
  const gyms = await fetch(`http://127.0.0.1:${address.port}/api/gyms`);
  assert.equal(gyms.status, 200);
});

test('cuentas, favoritos y sesiones sobreviven a la reapertura del almacenamiento', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'gymhora-auth-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'accounts.sqlite');
  const first = await createStore({ databaseUrl: '', sqlitePath: path, production: false });
  await first.createUser({ id: 'user-1', name: 'Ana', email: account.email, password_hash: 'test-hash' });
  await first.updateFavorites('user-1', ['demo-2']);
  await first.createSession('test-token-hash', 'user-1', Date.now() + 60000);
  await first.close();
  const second = await createStore({ databaseUrl: '', sqlitePath: path, production: false });
  try {
    assert.deepEqual(JSON.parse((await second.userByEmail(account.email)).favorites), ['demo-2']);
    assert.equal((await second.sessionUser('test-token-hash')).id, 'user-1');
  } finally { await second.close(); }
});
