import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStore } from '../auth-store.js';
import { createApplication } from '../server.js';

// Explicit opt-in: use an isolated test database, never the production URL.
test('PostgreSQL: registro, sesión, perfil y favoritos persisten tras reconectar', { skip: !process.env.GYMHORA_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.GYMHORA_TEST_DATABASE_URL;
  const email = `integration-${randomUUID()}@example.test`;
  let store = await createStore({ databaseUrl, production: true });
  let app = createApplication({ store, production: true, publicOrigin: 'https://gymhora.example.test' });
  let userId;
  const start = async () => {
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.address().port}`;
  };
  let base = await start();
  const call = async (path, body, cookie = '') => {
    const response = await fetch(base + '/api/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://gymhora.example.test', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    const registered = await call('register', { email, name: 'Prueba PostgreSQL', password: 'Una clave temporal para pruebas' });
    assert.equal(registered.response.status, 201);
    userId = registered.data.user.id;
    assert.match(registered.response.headers.get('set-cookie'), /Secure/);
    assert.equal((await call('register', { email, name: 'Duplicada', password: 'Una clave temporal para pruebas' })).response.status, 409);
    const login = await call('login', { email, password: 'Una clave temporal para pruebas' }, registered.cookie);
    assert.equal(login.response.status, 200);
    assert.equal((await call('session', undefined, registered.cookie)).data.user, null);
    assert.equal((await call('profile', { name: 'Perfil guardado', city: 'Santiago' }, login.cookie)).response.status, 200);
    assert.equal((await call('favorites', { favorites: ['demo-1', 'demo-4'] }, login.cookie)).response.status, 200);
    const manual = await call('gyms/create', { name: 'Gimnasio PostgreSQL', city: 'Santiago', area: 'Centro', status: 'medium' }, login.cookie);
    assert.equal(manual.response.status, 201);
    const gymId = manual.data.gym.id;
    await new Promise(resolve => app.close(resolve)); await store.close();
    store = await createStore({ databaseUrl, production: true });
    app = createApplication({ store, production: true, publicOrigin: 'https://gymhora.example.test' });
    base = await start();
    const restored = await call('session', undefined, login.cookie);
    assert.equal(restored.data.user.name, 'Perfil guardado');
    assert.equal(restored.data.user.city, 'Santiago');
    assert.deepEqual(restored.data.user.favorites, ['demo-1', 'demo-4']);
    const owned = await call('gyms', undefined, login.cookie);
    assert.equal(owned.data.gyms[0].id, gymId);
    assert.equal(owned.data.gyms[0].manualStatus, 'medium');
    const updated = await call('gyms/update', { id: gymId, name: 'Nombre actualizado', city: 'Santiago', area: 'Centro', status: 'busy' }, login.cookie);
    assert.equal(updated.data.gym.manualStatus, 'busy');
    assert.equal((await call('gyms/delete', { id: gymId }, login.cookie)).response.status, 200);
    await call('logout', {}, login.cookie);
    assert.equal((await call('session', undefined, login.cookie)).data.user, null);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await store.close();
    if (userId) {
      const { default: pg } = await import('pg');
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try { await client.query('DELETE FROM gymhora_users WHERE id = $1', [userId]); }
      finally { await client.end(); }
    }
  }
});
