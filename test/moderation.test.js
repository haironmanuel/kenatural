import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../auth-store.js';
import { createApplication } from '../server.js';
import { hashPassword } from '../auth.js';
import { isDisallowedGymName, REMOVAL_NOTICE } from '../name-policy.js';
const fields = { name: 'Hairon ass', city: 'Santiago', area: 'Centro', status: 'quiet', acceptTrial: true };
const password = 'Una clave temporal de prueba';
async function seed(t) {
  const folder = await mkdtemp(join(tmpdir(), 'gymhora-moderation-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const path = join(folder, 'accounts.sqlite');
  const store = await createStore({databaseUrl:'',sqlitePath:path});
  await store.createUser({id:'affected',email:'affected@example.test',name:'Autor',password_hash:await hashPassword(password)});
  await store.createUser({id:'other',email:'other@example.test',name:'Otra persona',password_hash:await hashPassword(password)});
  await store.createGym('remove-this', 'affected', fields);
  await store.createGym('keep-this', 'affected', {...fields,name:'Hairon Fitness'});
  await store.close();
  return path;
}
test('la política solo coincide con el nombre señalado y sus variantes de mayúsculas/espacios', () => {
  for (const name of ['Hairon ass', ' HAIRON ASS ', 'Hairon\tass', 'Hairon   Ass']) assert.equal(isDisallowedGymName(name), true);
  for (const name of ['Hairon Fitness', 'Class Fitness', 'Santiago Gym', 'Assistance Fitness']) assert.equal(isDisallowedGymName(name), false);
});
test('el despliegue elimina el gimnasio indicado y deja un aviso privado, persistente e idempotente', async t => {
  const path = await seed(t);
  let store = await createStore({databaseUrl:'',sqlitePath:path});
  assert.deepEqual((await store.listOwnedGyms('affected')).map(g=>g.id), ['keep-this']);
  assert.ok(!(await store.listPublicGyms()).some(g=>g.id==='remove-this'));
  assert.equal((await store.listNotices('other')).length, 0);
  const notices = await store.listNotices('affected');
  assert.equal(notices.length, 1); assert.equal(notices[0].message, REMOVAL_NOTICE);
  assert.ok(await store.userByEmail('affected@example.test'));
  await store.close();
  store = await createStore({databaseUrl:'',sqlitePath:path});
  assert.equal((await store.listNotices('affected')).length, 1);
  assert.equal(await store.acknowledgeNotice(notices[0].id, 'other'), undefined);
  assert.ok(await store.acknowledgeNotice(notices[0].id, 'affected'));
  await store.close();
  store = await createStore({databaseUrl:'',sqlitePath:path});
  try { assert.equal((await store.listNotices('affected')).length, 0); }
  finally { await store.close(); }
});
test('si el aviso no puede guardarse, el borrado se revierte incluyendo su historial', async t => {
  const path = await seed(t);
  const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER prevent_notice BEFORE INSERT ON gymhora_account_notices BEGIN SELECT RAISE(ABORT, 'test failure'); END;"); db.close();
  await assert.rejects(createStore({databaseUrl:'',sqlitePath:path}), /test failure/);
  const check = new DatabaseSync(path);
  try {
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM gymhora_manual_gyms WHERE id='remove-this'").get().count, 1);
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM gymhora_hourly_reports WHERE gym_id='remove-this'").get().count, 1);
  } finally { check.close(); }
});
test('el aviso llega al iniciar sesión, nadie más puede leerlo o confirmarlo, y el nombre no puede recrearse', async t => {
  const path = await seed(t);
  const store = await createStore({databaseUrl:'',sqlitePath:path});
  const app = createApplication({store});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));await store.close();});
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (endpoint, body, cookie='') => {
    const response = await fetch(base+'/api/auth/'+endpoint, {method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
    return {response,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const author = await call('login',{email:'affected@example.test',password});
  const other = await call('login',{email:'other@example.test',password});
  assert.equal(author.data.notices.length, 1); assert.deepEqual(other.data.notices, []);
  assert.deepEqual((await call('session')).data.notices, []);
  assert.equal((await call('session',undefined,author.cookie)).data.notices[0].message, REMOVAL_NOTICE);
  const noticeId = author.data.notices[0].id;
  assert.equal((await call('notices/ack',{id:noticeId},other.cookie)).response.status,404);
  assert.equal((await call('notices/ack',{id:noticeId})).response.status,401);
  assert.equal((await call('gyms/create',fields,author.cookie)).response.status,400);
  assert.equal((await call('gyms/update',{...fields,id:'keep-this'},author.cookie)).response.status,400);
  assert.equal((await call('gyms',undefined,author.cookie)).data.gyms[0].name,'Hairon Fitness');
  assert.equal((await call('notices/ack',{id:noticeId},author.cookie)).response.status,200);
  assert.deepEqual((await call('session',undefined,author.cookie)).data.notices,[]);
});
