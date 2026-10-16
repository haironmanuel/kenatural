import { getAccount, accountRequest } from './account.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const labels = { quiet: 'Tranquilo', medium: 'Moderado', busy: 'Muy concurrido' };
let owned = [], editing = null, deleting = null, owner = null, busy = false;
function resetForm() {
  editing = null; deleting = null;
  $('#gym-form').reset(); $('#gym-form-title').textContent = 'Añade tu gimnasio';
  $('#gym-save').textContent = 'Publicar gimnasio'; $('#gym-cancel').hidden = true;
  $('#gym-delete-confirm').hidden = true;
}
function list() {
  $('#owned-gyms').innerHTML = owned.length ? owned.map(g => `<article class="owned-gym"><div><strong>${esc(g.name)}</strong><p>${esc(g.area)} · ${esc(g.city)}</p><span class="badge ${g.manualStatus}">${labels[g.manualStatus]}</span><small>Último reporte: ${esc(new Date(g.observedAt).toLocaleString('es-DO', {timeZone:'America/Santo_Domingo'}))}</small></div><div class="owned-actions"><button type="button" data-edit-gym="${esc(g.id)}" aria-label="Editar ${esc(g.name)}">Editar y reportar</button><button type="button" data-delete-gym="${esc(g.id)}" aria-label="Eliminar ${esc(g.name)}">Eliminar</button></div></article>`).join('') : '<p class="gym-list-empty">Todavía no has añadido gimnasios. Empieza con el formulario de abajo.</p>';
}
async function reload() {
  const id = getAccount()?.id;
  const data = await accountRequest('gyms');
  if (id !== getAccount()?.id) return;
  owned = data.gyms; list();
}
async function openEditor() {
  if ($('#account-dialog').open) $('#account-dialog').close();
  resetForm(); $('#gym-status-message').textContent = '';
  const signedIn = Boolean(getAccount());
  $('#gym-guest').hidden = signedIn; $('#gym-workspace').hidden = !signedIn;
  if (!$('#gym-dialog').open) $('#gym-dialog').showModal();
  if (signedIn) {
    $('#owned-gyms').textContent = 'Cargando tus gimnasios…';
    try { await reload(); } catch (error) { $('#owned-gyms').textContent = error.message; }
  }
}
$('#my-gyms').onclick = openEditor;
$('#profile-gyms').onclick = openEditor;
$('#gym-login').onclick = () => { $('#gym-dialog').close(); $('#account-button').click(); };
$('#close-gyms').onclick = () => $('#gym-dialog').close();
$('#gym-cancel').onclick = () => { if (!busy) resetForm(); };
$('#cancel-gym-delete').onclick = () => { deleting = null; $('#gym-delete-confirm').hidden = true; };
$('#owned-gyms').onclick = event => {
  if (busy) return;
  const edit = event.target.closest('[data-edit-gym]'), remove = event.target.closest('[data-delete-gym]');
  if (edit) {
    const gym = owned.find(g => g.id === edit.dataset.editGym); if (!gym) return;
    resetForm(); editing = gym.id;
    for (const field of ['name', 'city', 'area']) $('#gym-' + field).value = gym[field];
    $('#gym-occupancy').value = gym.manualStatus;
    $('#gym-form-title').textContent = 'Actualiza tu gimnasio'; $('#gym-save').textContent = 'Guardar y actualizar reporte';
    $('#gym-cancel').hidden = false; $('#gym-status-message').textContent = ''; $('#gym-name').focus();
  }
  if (remove) {
    deleting = remove.dataset.deleteGym;
    $('#gym-delete-text').textContent = `¿Eliminar ${owned.find(g => g.id === deleting)?.name}? Dejará de aparecer en el listado público.`;
    $('#gym-delete-confirm').hidden = false; $('#confirm-gym-delete').focus();
  }
};
async function mutate(path, body, success) {
  if (busy) return; busy = true;
  $('#gym-save').disabled = true; $('#confirm-gym-delete').disabled = true;
  $('#gym-status-message').textContent = 'Guardando…';
  let saved = false;
  try {
    await accountRequest(path, body); saved = true;
    resetForm(); document.dispatchEvent(new Event('gymschanged'));
    await reload(); $('#gym-status-message').textContent = success;
  } catch (error) { $('#gym-status-message').textContent = (saved ? 'Se guardó el cambio, pero no pudimos recargar la lista. ' : '') + error.message; }
  finally { busy = false; $('#gym-save').disabled = false; $('#confirm-gym-delete').disabled = false; }
}
$('#gym-form').onsubmit = event => {
  event.preventDefault();
  const body = { status: $('#gym-occupancy').value };
  for (const field of ['name', 'city', 'area']) body[field] = $('#gym-' + field).value;
  if (editing) body.id = editing;
  mutate(editing ? 'gyms/update' : 'gyms/create', body, 'Tu gimnasio y su reporte se publicaron.');
};
$('#confirm-gym-delete').onclick = () => { if (deleting) mutate('gyms/delete', { id: deleting }, 'Gimnasio eliminado.'); };
document.addEventListener('accountchange', () => {
  const id = getAccount()?.id || null;
  if (id !== owner) {
    owner = id; owned = []; resetForm();
    if ($('#gym-dialog').open) $('#gym-dialog').close();
  }
});
