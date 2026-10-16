const $ = selector => document.querySelector(selector);
let user = null, available = false, mode = 'login', busy = false;
export const getAccount = () => user;

function announceAccount() {
  $('#account-button').textContent = user ? 'Mi perfil' : 'Iniciar sesión';
  $('#account-button').title = user ? `Perfil de ${user.name}` : 'Iniciar sesión o crear una cuenta';
  document.dispatchEvent(new Event('accountchange'));
}
async function request(path, body) {
  let response;
  try {
    response = await fetch('/api/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('No pudimos conectar. Comprueba tu conexión e intenta de nuevo.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('La aplicación no pudo leer la respuesta. Intenta de nuevo.'); }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') { user = null; announceAccount(); }
    throw new Error(data.error || 'No pudimos completar la solicitud.');
  }
  return data;
}
function setMode(next) {
  mode = next;
  const register = mode === 'register', profile = mode === 'profile';
  $('#auth-title').textContent = profile ? 'Tu perfil, tu ritmo.' : register ? 'Crea tu cuenta' : 'Qué bueno verte de nuevo';
  $('#auth-subtitle').textContent = profile ? 'Tu información y tus gimnasios favoritos en un solo lugar.' : 'Guarda tus favoritos y llévalos contigo en cada dispositivo.';
  $('#auth-tabs').hidden = profile;
  $('#credentials-form').hidden = profile;
  $('#profile-panel').hidden = !profile;
  $('#register-fields').hidden = !register;
  $('#confirm-field').hidden = !register;
  $('#auth-name').required = register;
  $('#auth-confirm').required = register;
  $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-password').type = 'password';
  $('#password-toggle').textContent = 'Mostrar';
  $('#password-toggle').setAttribute('aria-pressed', 'false');
  $('#auth-submit').textContent = register ? 'Crear mi cuenta' : 'Iniciar sesión';
  $('#tab-login').classList.toggle('selected', !register);
  $('#tab-register').classList.toggle('selected', register);
  $('#tab-login').setAttribute('aria-pressed', String(!register));
  $('#tab-register').setAttribute('aria-pressed', String(register));
  $('#auth-error').textContent = '';
  $('#profile-status').textContent = '';
  $('#auth-availability').hidden = available;
  $('#auth-submit').disabled = !available;
  if (profile && user) {
    $('#profile-initial').textContent = user.name.slice(0, 1).toLocaleUpperCase('es');
    $('#profile-name').value = user.name;
    $('#profile-city').value = user.city;
    $('#profile-email').textContent = user.email;
    $('#profile-count').textContent = `${user.favorites.length} ${user.favorites.length === 1 ? 'gimnasio favorito' : 'gimnasios favoritos'}`;
  }
}
export async function initializeAccount() {
  try {
    const data = await request('session');
    available = data.available; user = data.user;
    $('#auth-availability').textContent = data.error || '';
  } catch {
    available = false;
    $('#auth-availability').textContent = 'No pudimos conectar con el servicio de cuentas. Comprueba tu conexión o vuelve a intentarlo más tarde.';
  }
  announceAccount();
}
export async function saveAccountFavorites(favorites) {
  const id = user?.id;
  if (!id) throw new Error('Inicia sesión para guardar tus favoritos en el perfil.');
  const data = await request('favorites', { favorites });
  if (user?.id !== id) return;
  user = data.user; announceAccount();
}

$('#account-button').onclick = async () => {
  if (busy) return;
  await initializeAccount();
  setMode(user ? 'profile' : 'login');
  $('#auth-password').value = ''; $('#auth-confirm').value = '';
  $('#account-dialog').showModal();
};
$('#close-account').onclick = () => $('#account-dialog').close();
$('#tab-login').onclick = () => { if (!busy) setMode('login'); };
$('#tab-register').onclick = () => { if (!busy) setMode('register'); };
$('#password-toggle').onclick = () => {
  const show = $('#auth-password').type === 'password';
  $('#auth-password').type = show ? 'text' : 'password';
  $('#password-toggle').textContent = show ? 'Ocultar' : 'Mostrar';
  $('#password-toggle').setAttribute('aria-pressed', String(show));
};
$('#credentials-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !available) return;
  $('#auth-error').textContent = '';
  if (mode === 'register' && $('#auth-password').value !== $('#auth-confirm').value) {
    $('#auth-error').textContent = 'Las contraseñas no coinciden.'; $('#auth-confirm').focus(); return;
  }
  busy = true; $('#auth-submit').disabled = true;
  $('#auth-submit').textContent = mode === 'register' ? 'Creando tu cuenta…' : 'Iniciando sesión…';
  try {
    const data = await request(mode, { email: $('#auth-email').value, password: $('#auth-password').value, name: $('#auth-name').value });
    user = data.user; announceAccount();
    $('#credentials-form').reset();
    setMode('profile');
  } catch (error) { $('#auth-error').textContent = error.message; }
  finally {
    busy = false; $('#auth-submit').disabled = !available;
    $('#auth-submit').textContent = mode === 'register' ? 'Crear mi cuenta' : 'Iniciar sesión';
  }
};
$('#profile-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  busy = true; $('#profile-save').disabled = true; $('#profile-status').textContent = '';
  try {
    const data = await request('profile', { name: $('#profile-name').value, city: $('#profile-city').value });
    user = data.user; announceAccount(); setMode('profile');
    $('#profile-status').textContent = 'Perfil guardado.';
  } catch (error) { $('#profile-status').textContent = error.message; }
  finally { busy = false; $('#profile-save').disabled = false; }
};
$('#logout').onclick = async () => {
  if (busy) return; busy = true; $('#logout').disabled = true;
  try {
    await request('logout', {}); user = null; announceAccount(); setMode('login');
    $('#auth-error').textContent = 'Cerraste tu sesión correctamente.';
  } catch (error) { $('#profile-status').textContent = error.message; }
  finally { busy = false; $('#logout').disabled = false; }
};
