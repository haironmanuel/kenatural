import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../auth-store.js';
import { manualGym } from '../manual-gyms.js';
import { reportTime, reportDays } from '../hourly-reports.js';
const fields = { name: 'Gym historial', city: 'Santiago', area: 'Centro', status: 'quiet' };
const user = { id: 'hourly-user', email: 'history@example.test', name: 'Historial', password_hash: 'test-only' };

test('horas y cambio de fecha usan República Dominicana, no la zona del servidor', () => {
  assert.deepEqual(reportTime(Date.parse('2026-10-17T03:59:00Z')), { date: '2026-10-16', hour: 23 });
  assert.deepEqual(reportTime(Date.parse('2026-10-17T04:00:00Z')), { date: '2026-10-17', hour: 0 });
  assert.equal(reportDays(Date.parse('2026-10-17T01:00:00Z'))[0], '2026-10-16');
});

test('guarda el último nivel por hora, mantiene horas separadas y no inventa porcentajes', async () => {
  let clock = Date.parse('2026-10-16T10:05:00Z');
  const store = await createStore({ databaseUrl: '', sqlitePath: ':memory:', now: () => clock });
  try {
    await store.createUser(user); await store.createGym('hourly-gym', user.id, fields);
    clock = Date.parse('2026-10-16T10:55:00Z');
    await store.updateGym('hourly-gym', user.id, { ...fields, status: 'busy' });
    clock = Date.parse('2026-10-16T11:15:00Z');
    await store.updateGym('hourly-gym', user.id, { ...fields, status: 'medium' });
    const row = (await store.listOwnedGyms(user.id))[0]; const gym = manualGym(row);
    assert.equal(row.hourly_reports.length, 2);
    assert.equal(gym.reportHistory.length, 7); assert.equal(gym.reportHistory[0].hours.length, 24);
    assert.equal(gym.reportHistory[0].hours[6].level, 3);
    assert.equal(gym.reportHistory[0].hours[6].reportedAt, '2026-10-16T10:55:00.000Z');
    assert.equal(gym.reportHistory[0].hours[7].level, 2);
    assert.equal(gym.reportHistory[0].hours[8].level, null);
    assert.equal(gym.reportHistory[0].hours[8].status, null);
    assert.equal(gym.reportHistory[0].hours[8].reportedAt, null);
    assert.equal(gym.people, null); assert.equal(gym.capacity, null); assert.deepEqual(gym.hourly, []);
  } finally { await store.close(); }
});

test('separa días a medianoche y las horas sin reportes conservan null', async () => {
  let clock = Date.parse('2026-10-17T03:59:00Z');
  const store = await createStore({ databaseUrl: '', sqlitePath: ':memory:', now: () => clock });
  try {
    await store.createUser(user); await store.createGym('midnight', user.id, fields);
    clock = Date.parse('2026-10-17T04:01:00Z');
    await store.updateGym('midnight', user.id, { ...fields, status: 'busy' });
    const history = manualGym((await store.listOwnedGyms(user.id))[0]).reportHistory;
    assert.equal(history[0].date, '2026-10-17'); assert.equal(history[0].hours[0].level, 3);
    assert.equal(history[1].date, '2026-10-16'); assert.equal(history[1].hours[23].level, 1);
    assert.equal(history[0].hours[23].level, null);
  } finally { await store.close(); }
});

test('solo el autor puede generar reportes y borrar el gimnasio elimina su historial', async () => {
  let clock = Date.parse('2026-10-16T10:00:00Z');
  const store = await createStore({ databaseUrl: '', sqlitePath: ':memory:', now: () => clock });
  try {
    await store.createUser(user); await store.createGym('protected', user.id, fields);
    clock += 3600000;
    assert.equal(await store.updateGym('protected', 'another-user', { ...fields, status: 'busy' }), undefined);
    assert.equal((await store.listOwnedGyms(user.id))[0].hourly_reports.length, 1);
    await store.deleteGym('protected', user.id);
    await store.createGym('protected', user.id, { ...fields, status: 'medium' });
    const reports = (await store.listOwnedGyms(user.id))[0].hourly_reports;
    assert.equal(reports.length, 1); assert.equal(reports[0].status, 'medium');
  } finally { await store.close(); }
});

test('conserva el historial al reconectar y elimina reportes fuera de los siete días de calendario', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gymhora-hourly-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const path = join(dir, 'accounts.sqlite'); let clock = Date.parse('2026-10-16T10:00:00Z');
  let store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => clock });
  await store.createUser(user); await store.createGym('persisted', user.id, fields); await store.close();
  store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => clock });
  assert.equal((await store.listOwnedGyms(user.id))[0].hourly_reports.length, 1); await store.close();
  clock = Date.parse('2026-10-23T10:00:00Z');
  store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => clock });
  try { assert.equal((await store.listOwnedGyms(user.id))[0].hourly_reports.length, 0); }
  finally { await store.close(); }
});

test('al migrar una sede anterior solo recupera su reporte conocido, con su fecha original', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gymhora-legacy-hourly-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const path = join(dir, 'accounts.sqlite'); let clock = Date.parse('2026-10-16T10:00:00Z');
  let store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => clock });
  await store.createUser(user); await store.createGym('legacy', user.id, fields);
  clock += 3600000; await store.updateGym('legacy', user.id, {...fields,status:'busy'}); await store.close();
  const {DatabaseSync} = await import('node:sqlite'); const db = new DatabaseSync(path);
  db.exec('DROP TABLE gymhora_hourly_reports'); db.close();
  store = await createStore({ databaseUrl: '', sqlitePath: path, now: () => clock + 3600000 });
  try {
    const reports = (await store.listOwnedGyms(user.id))[0].hourly_reports;
    assert.equal(reports.length, 1); assert.equal(reports[0].status, 'busy');
    assert.equal(Number(reports[0].reported_at), clock);
  } finally { await store.close(); }
});
