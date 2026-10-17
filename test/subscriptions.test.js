import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../auth-store.js';
import { listingSubscription, LISTING_PLAN, TRIAL_MS } from '../subscriptions.js';

const fields = { name: 'Gym de prueba', city: 'Santiago', area: 'Centro', status: 'quiet' };
const user = { id: 'publisher', name: 'Publicador', email: 'publisher@example.test', password_hash: 'test-only' };
test('plan mensual DOP 1599, siete días exactos y pagos todavía deshabilitados', () => {
  assert.equal(LISTING_PLAN.amount, 159900);
  assert.equal(LISTING_PLAN.currency, 'DOP'); assert.equal(LISTING_PLAN.interval, 'month');
  assert.equal(LISTING_PLAN.trialDays, 7); assert.equal(TRIAL_MS, 604800000);
  assert.equal(LISTING_PLAN.paymentsAvailable, false);
});

test('al vencer la prueba se oculta el gimnasio, sin perder sus datos ni reiniciar al editar', async () => {
  let clock = Date.now();
  const store = await createStore({ databaseUrl: '', sqlitePath: ':memory:', now: () => clock });
  try {
    await store.createUser(user);
    const gym = await store.createGym('gym-1', user.id, fields);
    const end = clock + TRIAL_MS;
    assert.equal(Number(gym.trial_ends_at), end);
    assert.equal(listingSubscription(gym, clock).status, 'trialing');
    assert.equal((await store.listPublicGyms()).length, 1);
    clock = end - 1;
    assert.equal((await store.listPublicGyms()).length, 1);
    clock = end;
    assert.equal((await store.listPublicGyms()).length, 0);
    const privateGyms = await store.listOwnedGyms(user.id);
    assert.equal(privateGyms.length, 1);
    assert.equal(listingSubscription(privateGyms[0], clock).status, 'expired');
    await store.updateGym('gym-1', user.id, { ...fields, name: 'Nombre nuevo' });
    assert.equal((await store.listPublicGyms()).length, 0);
    assert.equal(Number((await store.listOwnedGyms(user.id))[0].trial_ends_at), end);
  } finally { await store.close(); }
});

test('la prueba se comparte por cuenta y borrar/recrear no ofrece otros siete días', async () => {
  let clock = Date.now();
  const start = clock;
  const store = await createStore({ databaseUrl: '', sqlitePath: ':memory:', now: () => clock });
  try {
    await store.createUser(user); await store.createGym('one', user.id, fields);
    clock += 86400000;
    const second = await store.createGym('two', user.id, fields);
    assert.equal(Number(second.trial_ends_at), start + TRIAL_MS);
    await store.deleteGym('one', user.id); await store.deleteGym('two', user.id);
    clock = start + TRIAL_MS + 1;
    const recreated = await store.createGym('three', user.id, fields);
    assert.equal(listingSubscription(recreated, clock).visible, false);
    assert.equal((await store.listPublicGyms()).length, 0);
    await store.createUser({ ...user, id: 'another', email: 'another@example.test' });
    const another = await store.createGym('four', 'another', fields);
    assert.equal(listingSubscription(another, clock).trialDaysRemaining, 7);
  } finally { await store.close(); }
});

test('la migración de gimnasios anteriores concede una sola prueba y no se reinicia al redesplegar', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'gymhora-trial-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'accounts.sqlite');
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE gymhora_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, favorites TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE gymhora_manual_gyms (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES gymhora_users(id), name TEXT NOT NULL, city TEXT NOT NULL, area TEXT NOT NULL, status TEXT NOT NULL, updated_at BIGINT NOT NULL);
    INSERT INTO gymhora_users (id,email,name,password_hash) VALUES ('publisher','test@example.test','Test','hash');
    INSERT INTO gymhora_manual_gyms VALUES ('legacy','publisher','Gym anterior','Santiago','Centro','quiet',0);`);
  old.close();
  const start = Date.now();
  let store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => start });
  assert.equal((await store.listPublicGyms()).length, 1);
  const end = Number((await store.listOwnedGyms(user.id))[0].trial_ends_at);
  assert.equal(end, start + TRIAL_MS); await store.close();
  store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => end + 1 });
  try {
    assert.equal((await store.listPublicGyms()).length, 0);
    assert.equal(Number((await store.listOwnedGyms(user.id))[0].trial_ends_at), end);
  } finally { await store.close(); }
});

test('una suscripción pagada dura solo hasta su vencimiento, por gimnasio', () => {
  const clock = Date.now();
  const row = { trial_ends_at: clock - 1, paid_until: clock + 1000 };
  assert.equal(listingSubscription(row, clock).status, 'active');
  assert.equal(listingSubscription(row, clock + 1000).status, 'expired');
  assert.equal(listingSubscription({ trial_ends_at: clock - 1 }, clock).visible, false);
});
