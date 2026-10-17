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
    const manual = await call('gyms/create', { name: 'Gimnasio PostgreSQL', city: 'Santiago', area: 'Centro', status: 'medium', acceptTrial: true }, login.cookie);
    assert.equal(manual.response.status, 201);
    const gymId = manual.data.gym.id;
    assert.equal(manual.data.gym.subscription.status, 'trialing');
    const { default: pg } = await import('pg');
    const clockClient = new pg.Client({ connectionString: databaseUrl });
    await clockClient.connect();
    try { await clockClient.query('UPDATE gymhora_publisher_trials SET trial_ends_at = $1 WHERE owner_id = $2', [Date.now() - 1000, userId]); }
    finally { await clockClient.end(); }
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
    assert.ok(owned.data.gyms[0].reportHistory[0].hours.some(h => h.level === 2));
    assert.equal(owned.data.gyms[0].subscription.status, 'expired');
    const publicGyms = await (await fetch(base + '/api/gyms')).json();
    assert.ok(!publicGyms.gyms.some(g => g.id === gymId));
    // A trusted, isolated test fixture simulates a verified paid period. There
    // is deliberately no client endpoint that grants payment status.
    const paymentClient = new pg.Client({ connectionString: databaseUrl });
    await paymentClient.connect();
    try { await paymentClient.query('INSERT INTO gymhora_listing_subscriptions (gym_id, paid_until, verified_payment_reference) VALUES ($1,$2,$3)', [gymId, Date.now() + 86400000, 'test-' + randomUUID()]); }
    finally { await paymentClient.end(); }
    assert.equal((await call('gyms', undefined, login.cookie)).data.gyms[0].subscription.status, 'active');
    assert.ok((await (await fetch(base + '/api/gyms')).json()).gyms.some(g => g.id === gymId));
    const updated = await call('gyms/update', { id: gymId, name: 'Nombre actualizado', city: 'Santiago', area: 'Centro', status: 'busy' }, login.cookie);
    assert.equal(updated.data.gym.manualStatus, 'busy');
    assert.ok(updated.data.gym.reportHistory[0].hours.some(h => h.level === 3));
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
