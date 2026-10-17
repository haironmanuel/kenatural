import './gym-editor.js';
import {manualChart, manualHistoryPanel} from './hourly-chart.js';
import {getAccount, initializeAccount, saveAccountFavorites} from './account.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let gyms=[],mode='demo',filter='all',onlyFavorites=false,selected=null,selectedReportDate=null,installPrompt=null,connectionError=false;
let favorites=new Set();
try{const saved=JSON.parse(localStorage.getItem('gymhora-favorites')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(x=>typeof x==='string'));}catch{}
const isStale=g=>!g.demo&&(connectionError||Date.now()-Date.parse(g.observedAt)>(g.manual?7200000:120000));
const percent=g=>Math.round(g.people/g.capacity*100);
const category=g=>isStale(g)?'stale':g.manual?g.manualStatus:percent(g)<45?'quiet':percent(g)<70?'medium':'busy';
const names={quiet:'Tranquilo',medium:'Moderado',busy:'Muy concurrido',stale:'Sin dato actual'};
const timeFormat=new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',hour:'2-digit',minute:'2-digit'});
const hourLabel=h=>`${String(h).padStart(2,'0')}:00`;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3500);}
function saveFavorites(){try{localStorage.setItem('gymhora-favorites',JSON.stringify([...favorites]));}catch{toast('Tu navegador no permite guardar favoritos. Se conservarán durante esta visita.');}}
function filtered(){const query=$('#search').value.trim().toLocaleLowerCase('es');return gyms.filter(g=>(!onlyFavorites||favorites.has(g.id))&&(!$('#city').value||g.city===$('#city').value)&&(!query||`${g.name} ${g.area} ${g.city}`.toLocaleLowerCase('es').includes(query))&&(filter==='all'||category(g)===filter));}
function bars(g,detail=false){if(!g.hourly.length)return '<p>No hay historial horario disponible.</p>';return `<div class="chart ${detail?'detail-chart':''}" role="img" aria-label="${esc(g.demo?'Ejemplo de ocupación por hora':'Ocupación histórica por hora')}">${g.hourly.map(h=>`<span class="bar ${h.occupancy>=70?'peak':''}" data-height="${h.occupancy}" title="${hourLabel(h.hour)}: ${h.occupancy}%"></span>`).join('')}</div><div class="chart-hours"><span>${hourLabel(g.hourly[0].hour)}</span><span>${hourLabel(g.hourly[Math.floor(g.hourly.length/2)].hour)}</span><span>${hourLabel(g.hourly.at(-1).hour)}</span></div>`;}
function paintBars(root=document){root.querySelectorAll('[data-height]').forEach(el=>el.style.setProperty('--bar-height',`${Math.max(3,Number(el.dataset.height))}%`));root.querySelectorAll('[data-fill]').forEach(el=>el.style.setProperty('--fill',`${Math.min(100,Number(el.dataset.fill))}%`));}
function bestHour(g){if(!g.hourly.length)return 'Sin historial';const best=g.hourly.reduce((a,b)=>a.occupancy<=b.occupancy?a:b);return `${hourLabel(best.hour)}`;}
function render(){
 $('#fav-count').textContent=gyms.filter(g=>favorites.has(g.id)).length;
 $('#total').textContent=gyms.length;$('#quiet-total').textContent=gyms.filter(g=>category(g)==='quiet').length;
 $('#list-title').textContent=onlyFavorites?'Tus gimnasios favoritos':'Encuentra tu espacio';
 const list=filtered();$('#result-count').textContent=`${list.length} ${list.length===1?'gimnasio':'gimnasios'} · República Dominicana`;
 $('#empty').hidden=list.length>0;
 $('#cards').innerHTML=list.map((g,i)=>{
 const cat=category(g),stale=isStale(g),saved=favorites.has(g.id);
 const reading=g.manual?`<span class="manual-reading">Reporte manual</span>`:`<span class="occupancy">${stale?'—':percent(g)+'%'} <small>ocupación</small></span>`;
 const body=g.manual?`${manualChart(g)}<div class="people"><span>${esc(new Date(g.observedAt).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo'}))}</span><span>Actualización manual</span></div>`:`<div class="meter ${cat}"><span data-fill="${stale?0:percent(g)}"></span></div><div class="people"><span>${stale?'Dato desactualizado':`${g.people} de ${g.capacity} personas`}</span><span>${g.demo?'Simulación':'Fuente conectada'}</span></div><div class="mini-heading"><span>Ocupación por hora</span><span class="demo-tag">${g.demo?'EJEMPLO':'HISTORIAL'}</span></div>${bars(g)}`;
 return `<article class="gym-card" data-gym-id="${esc(g.id)}"><div class="card-top"><span class="gym-logo tone${i%3}" aria-hidden="true">${esc(g.name.split(' ').slice(0,2).map(s=>s[0]).join(''))}</span><button class="favorite ${saved?'saved':''}" data-favorite="${esc(g.id)}" aria-label="${saved?'Quitar de':'Añadir a'} favoritos: ${esc(g.name)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div><div class="card-content"><h3>${esc(g.name)}</h3><p class="location">⌖ ${esc(g.area)} · ${esc(g.city)}</p><div class="occupancy-row"><span class="badge ${cat}"><i class="dot ${cat}"></i>${names[cat]}</span>${reading}</div>${body}</div><div class="card-footer"><span>${g.manual?'REPORTES · SIN VERIFICAR':g.hourly.length?'↘ Menor afluencia: '+bestHour(g):'Sin historial'}</span><button data-detail="${esc(g.id)}">Ver detalle ↗</button></div></article>`;
 }).join('');paintBars();
}
function showDetail(id){
 if(selected!==id)selectedReportDate=null;
 selected=id;const g=gyms.find(g=>g.id===id);
 if(!g){if($('#details').open)$('#details').close();return;}
 const stale=isStale(g);const peak=g.hourly.length?g.hourly.reduce((a,b)=>a.occupancy>=b.occupancy?a:b):null;
 const reading=g.manual?`<div class="manual-detail-status">${names[category(g)]}</div><p>Ocupación indicada manualmente, sin conteo de personas. No implica que la persona que lo añadió sea su propietaria.</p>`:`<div class="detail-count">${stale?'—':g.people}<small> ${stale?'sin conteo actual':'/ '+g.capacity+' personas'}</small></div>`;
 const history=g.manual?manualHistoryPanel(g,selectedReportDate):`<h3>${g.demo?'Ejemplo de horas pico':'Historial horario de la fuente'}</h3>${bars(g,true)}<p>${peak?`Mayor afluencia: <strong>${hourLabel(peak.hour)} (${peak.occupancy}%)</strong>. Menor afluencia: <strong>${bestHour(g)}</strong>.`:'Esta fuente no ofrece historial por hora.'}</p>`;
 const note=g.demo?'Estos valores son ilustrativos y no describen un gimnasio real. No hay personas siendo rastreadas.':g.manual?`Último reporte: ${esc(new Date(g.observedAt).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo'}))}. ${stale?'El reporte no se considera reciente.':'El reporte tiene menos de 2 horas.'} No es una medición automática, ni predice horas pico.`:`Última medición: ${esc(new Date(g.observedAt).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo'}))}. ${stale?'La medición no se considera actual.':'Medición recibida hace menos de 2 minutos.'} Las horas pico son históricas; no garantizan la asistencia futura.`;
 $('#detail-body').innerHTML=`<div class="eyebrow">${g.demo?'GIMNASIO FICTICIO · DEMOSTRACIÓN':'FUENTE: '+esc(g.source)}</div><h2>${esc(g.name)}</h2><p>⌖ ${esc(g.area)}, ${esc(g.city)}</p>${reading}${history}<div class="detail-note">${note}</div><div class="detail-actions"><button id="detail-favorite">${favorites.has(g.id)?'♥ Quitar de favoritos':'♡ Guardar favorito'}</button><button id="detail-export">↓ Descargar CSV</button></div>`;
 if(g.manual){selectedReportDate=$('#report-day')?.value;$('#report-day')?.addEventListener('change',event=>{selectedReportDate=event.target.value;showDetail(id);$('#report-day').focus();});}
 paintBars($('#details'));$('#detail-favorite').onclick=()=>{toggleFavorite(id);showDetail(id);};$('#detail-export').onclick=()=>exportCSV([g]);if(!$('#details').open)$('#details').showModal();
}
let favoriteBusy=false;
async function toggleFavorite(id){
 if(favoriteBusy)return;
 if(getAccount()){
  favoriteBusy=true;
  const next=new Set(favorites);next.has(id)?next.delete(id):next.add(id);
  try{await saveAccountFavorites([...next]);if($('#details').open)showDetail(selected);}
  catch(error){toast(error.message);}
  finally{favoriteBusy=false;}
 }else{favorites.has(id)?favorites.delete(id):favorites.add(id);saveFavorites();render();}
}
document.addEventListener('accountchange',()=>{
 const user=getAccount();
 if(user)favorites=new Set(user.favorites);
 else{favorites=new Set();try{const saved=JSON.parse(localStorage.getItem('gymhora-favorites')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(x=>typeof x==='string'));}catch{}}
 render();if($('#details').open)showDetail(selected);
});
function showInfo(install=false){$('#info-title').textContent=install?'Lleva GymHora contigo':'Lo que ves en GymHora';$('#info-body').innerHTML=install?`<p>Abre la aplicación desde una dirección HTTPS para instalarla.</p><ol><li><strong>Android / Chrome:</strong> menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio».</li><li><strong>iPhone / Safari:</strong> Compartir → «Añadir a pantalla de inicio».</li><li><strong>Computadora:</strong> busca el icono de instalación en la barra de direcciones de Chrome o Edge.</li></ol><p>La interfaz puede abrirse sin conexión después de la primera visita. La ocupación actual necesita internet y una fuente conectada.</p>`:`<p><strong>Cada tarjeta identifica su origen.</strong> Los ejemplos son ficticios; los gimnasios añadidos por usuarios muestran reportes manuales sin verificar. No hemos verificado un directorio de gimnasios en internet.</p><p>Puedes añadir y editar tus gimnasios desde Mis gimnasios. Un reporte manual usa Tranquilo, Moderado o Muy concurrido, sin inventar personas ni porcentajes. Deja de considerarse reciente después de 2 horas. Las gráficas de los gimnasios registrados guardan el último nivel de cada hora y permiten consultar los últimos 7 días. La escala 1–3 no representa un porcentaje.</p><p>Un conteo en tiempo real requiere una fuente autorizada: por ejemplo, un sistema de entradas y salidas del gimnasio. Los horarios populares publicados en otros sitios no equivalen a un conteo de personas.</p><p>La aplicación está preparada para consultar una fuente cada 30 segundos. Las mediciones de más de 2 minutos se identifican como desactualizadas. Las gráficas muestran el perfil horario que aporte esa fuente.</p><p>La descarga CSV incluye el tipo de dato, la fuente y la fecha de la medición. Como invitado, tus favoritos se guardan en este dispositivo. Con una cuenta, se guardan en tu perfil.</p>`;$('#info').showModal();}
function exportCSV(list){
 if(!list.length){toast('No hay gimnasios para descargar con estos filtros.');return;}
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=[['id','gimnasio','ciudad','sector','tipo','fuente','medicion_UTC','personas_ultima_medicion','capacidad','estado','hora_RD','ocupacion_historica_porcentaje','ocupacion_reportada','fecha_RD','nivel_manual_1_a_3']];
 list.forEach(g=>{
  const common=[g.id,g.name,g.city,g.area,g.demo?'DEMOSTRACION':g.manual?'REPORTE_MANUAL':'FUENTE_CONECTADA',g.source];
  if(g.manual){
   let added=false;
   for(const day of g.reportHistory||[])for(const h of day.hours)if(h.level!==null){
    rows.push([...common,h.reportedAt,'','','REPORTE_HISTORICO_SIN_VERIFICAR',hourLabel(h.hour),'',names[h.status],day.date,h.level]);added=true;
   }
   if(!added)rows.push([...common,g.observedAt||'','','','SIN_HISTORIAL','','',names[g.manualStatus],'','']);
  }else (g.hourly.length?g.hourly:[{hour:'',occupancy:''}]).forEach(h=>rows.push([...common,g.observedAt||'',g.people,g.capacity,g.demo?'FICTICIO':isStale(g)?'DESACTUALIZADO':'ACTUAL',h.hour===''?'':hourLabel(h.hour),h.occupancy,'','','']));
 });
 const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`gymhora-${list.every(g=>g.demo)?'demo':'datos'}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV descargado con la fuente y el tipo de datos.');
}
let loadSequence=0;
async function load(){const sequence=++loadSequence;try{
 const res=await fetch('/api/gyms',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error();const data=await res.json();if(sequence!==loadSequence)return;gyms=data.gyms;mode=data.mode;connectionError=false;$('#error').hidden=!data.warning;$('#error').textContent=data.warning||'';
 const chosen=$('#city').value;$('#city').innerHTML='<option value="">Todas las ciudades</option>'+[...new Set(gyms.map(g=>g.city))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');if([...$('#city').options].some(o=>o.value===chosen))$('#city').value=chosen;
 const manualCount=gyms.filter(g=>g.manual).length;
 $('#data-notice').querySelector('p').innerHTML=mode==='demo'?(manualCount?'<strong>Ejemplos y comunidad.</strong> Las tarjetas EJEMPLO son ficticias. Los reportes manuales de usuarios no están verificados.':'<strong>Estás explorando una demostración.</strong> Los gimnasios y conteos son ficticios. No representan asistencia real.'):'<strong>Datos con fuentes identificadas.</strong> Las mediciones automáticas y los reportes manuales se distinguen en cada tarjeta.';
 $('#update-status').textContent=mode==='demo'&&!manualCount?'Modo demostración':'Consulta: '+timeFormat.format(new Date());render();if($('#details').open)showDetail(selected);
 }catch{if(sequence!==loadSequence)return;connectionError=true;$('#error').textContent='No pudimos actualizar los datos. Comprueba tu conexión. Las mediciones anteriores no se muestran como actuales.';$('#error').hidden=false;$('#update-status').textContent='Sin conexión con la fuente';render();if($('#details').open)showDetail(selected);}}
document.addEventListener('gymschanged',load);
$('#cards').addEventListener('click',e=>{const fav=e.target.closest('[data-favorite]'),detail=e.target.closest('[data-detail]');if(fav)toggleFavorite(fav.dataset.favorite);if(detail)showDetail(detail.dataset.detail);});
$('#search').addEventListener('input',render);$('#city').addEventListener('change',render);
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b);});render();});
function setView(fav){onlyFavorites=fav;$('#favorites').classList.toggle('active',fav);$('#explore').classList.toggle('active',!fav);render();}
$('#favorites').onclick=()=>setView(true);$('#explore').onclick=()=>setView(false);
$('#reset').onclick=()=>{$('#search').value='';$('#city').value='';document.querySelector('[data-filter="all"]').click();};
$('#export').onclick=()=>exportCSV(filtered());$('#about').onclick=()=>showInfo();$('#source-info').onclick=()=>showInfo();$('#close-details').onclick=()=>$('#details').close();$('#close-info').onclick=()=>$('#info').close();$('#info-ok').onclick=()=>$('#info').close();
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
const installApp=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else showInfo(true);};
$('#install').onclick=installApp;$('#install-mobile').onclick=installApp;
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function clock(){const t=timeFormat.format(new Date());$('#clock').textContent=t;$('#local-time').textContent='🇩🇴 '+t+' · RD';}
clock();setInterval(clock,30000);await Promise.all([load(),initializeAccount()]);setInterval(()=>{if(!document.hidden)load();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});window.addEventListener('online',load);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
