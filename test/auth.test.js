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
const gymInput = { name: 'Gimnasio de prueba', city: 'Santo Domingo', area: 'Piantini', status: 'quiet' };

test('gimnasios manuales: creación pública, actualización y eliminación con sesión', async t => {
  const f = await fixture(t); const session = await register(f);
  const created = await f.call('gyms/create', { ...gymInput, people: 999, capacity: 1000, observedAt: '2000-01-01', owner_id: 'injected' }, session.cookie);
  assert.equal(created.response.status, 201);
  const gym = created.data.gym;
  assert.equal(gym.manual, true); assert.equal(gym.demo, false);
  assert.equal(gym.people, null); assert.equal(gym.capacity, null); assert.deepEqual(gym.hourly, []);
  assert.equal(gym.manualStatus, 'quiet'); assert.equal(gym.owner_id, undefined);
  assert.ok(Math.abs(Date.now() - Date.parse(gym.observedAt)) < 5000);
  const own = await f.call('gyms', undefined, session.cookie); assert.equal(own.data.gyms.length, 1);
  const publicResponse = await fetch(`http://127.0.0.1:${f.app.address().port}/api/gyms`);
  const publicData = await publicResponse.json();
  assert.ok(publicData.gyms.some(g => g.id === gym.id));
  assert.ok(!JSON.stringify(publicData).includes(account.email));
  const update = await f.call('gyms/update', { ...gymInput, id: gym.id, status: 'busy', name: 'Nuevo nombre' }, session.cookie);
  assert.equal(update.response.status, 200); assert.equal(update.data.gym.manualStatus, 'busy');
  assert.equal(update.data.gym.name, 'Nuevo nombre');
  assert.equal((await f.call('gyms/delete', { id: gym.id }, session.cookie)).response.status, 200);
  assert.equal((await f.call('gyms', undefined, session.cookie)).data.gyms.length, 0);
});

test('un usuario no puede modificar, borrar ni listar los gimnasios privados de otro', async t => {
  const f = await fixture(t); const owner = await register(f);
  const other = await f.call('register', { ...account, email: 'otro@example.test' });
  const created = await f.call('gyms/create', gymInput, owner.cookie); const id = created.data.gym.id;
  assert.equal((await f.call('gyms')).response.status, 401);
  assert.equal((await f.call('gyms/create', gymInput)).response.status, 401);
  assert.equal((await f.call('gyms', undefined, other.cookie)).data.gyms.length, 0);
  assert.equal((await f.call('gyms/update', { ...gymInput, id, owner_id: owner.data.user.id }, other.cookie)).response.status, 404);
  assert.equal((await f.call('gyms/delete', { id, owner_id: owner.data.user.id }, other.cookie)).response.status, 404);
  assert.equal((await f.call('gyms', undefined, owner.cookie)).data.gyms[0].manualStatus, 'quiet');
});

test('valida los datos de gimnasio, el origen y el límite por cuenta', async t => {
  const f = await fixture(t); const session = await register(f);
  for (const patch of [{ status: 'inventado' }, { name: '' }, { city: 'a' }, { area: '' }, { name: 'a'.repeat(101) }]) {
    assert.equal((await f.call('gyms/create', { ...gymInput, ...patch }, session.cookie)).response.status, 400);
  }
  assert.equal((await f.call('gyms/create', gymInput, session.cookie, 'https://otro.test')).response.status, 403);
  for (let i = 0; i < 20; i++) await f.store.createGym('quota-' + i, session.data.user.id, gymInput);
  assert.equal((await f.call('gyms/create', gymInput, session.cookie)).response.status, 409);
});

test('si falla la comunidad avisa y conserva los ejemplos disponibles', async t => {
  const f = await fixture(t);
  f.store.listPublicGyms = async () => { throw new Error('database unavailable'); };
  const response = await fetch(`http://127.0.0.1:${f.app.address().port}/api/gyms`);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.gyms.length, 6); assert.ok(data.warning);
});

test('si falla la fuente automática conserva reportes manuales con un aviso, sin inventar mediciones', async t => {
  const f = await fixture(t); const session = await register(f);
  await f.call('gyms/create', gymInput, session.cookie);
  const previous = process.env.GYM_DATA_URL;
  process.env.GYM_DATA_URL = 'http://unsupported.invalid';
  t.after(() => { if (previous === undefined) delete process.env.GYM_DATA_URL; else process.env.GYM_DATA_URL = previous; });
  const response = await fetch(`http://127.0.0.1:${f.app.address().port}/api/gyms`);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.gyms.length, 1); assert.ok(data.gyms[0].manual);
  assert.equal(data.mode, 'live'); assert.ok(data.warning);
});

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
  await first.createGym('persisted-gym', 'user-1', gymInput);
  await first.createSession('test-token-hash', 'user-1', Date.now() + 60000);
  await first.close();
  const second = await createStore({ databaseUrl: '', sqlitePath: path, production: false });
  try {
    assert.deepEqual(JSON.parse((await second.userByEmail(account.email)).favorites), ['demo-2']);
    assert.equal((await second.sessionUser('test-token-hash')).id, 'user-1');
    assert.equal((await second.listOwnedGyms('user-1'))[0].status, 'quiet');
  } finally { await second.close(); }
});
