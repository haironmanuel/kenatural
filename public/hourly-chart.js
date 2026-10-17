const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const labels = { quiet: 'Tranquilo', medium: 'Moderado', busy: 'Muy concurrido' };
export const hourText = hour => String(hour).padStart(2, '0') + ':00';
export function manualDay(gym, date) {
  return gym.reportHistory?.find(day => day.date === date) || gym.reportHistory?.[0] || { date: '', hours: [] };
}
export function manualSummary(gym, date) {
  const reports = manualDay(gym, date).hours.filter(h => h.level !== null);
  if (!reports.length) return 'Todavía no hay reportes para este día.';
  if (reports.length === 1) return `Hay un reporte a las ${hourText(reports[0].hour)}. Faltan otras horas para comparar.`;
  const high = reports.reduce((a, b) => a.level >= b.level ? a : b);
  const low = reports.reduce((a, b) => a.level <= b.level ? a : b);
  if (high.level === low.level) return `${reports.length} horas con el mismo nivel reportado: ${labels[high.status]}.`;
  return `Mayor nivel reportado: ${hourText(high.hour)} (${labels[high.status]}). Menor: ${hourText(low.hour)} (${labels[low.status]}). Solo compara horas con reportes.`;
}
export function manualChart(gym, date, detail = false) {
  const day = manualDay(gym, date);
  const hours = day.hours.length ? day.hours : Array.from({ length: 24 }, (_, hour) => ({ hour, level: null, status: null }));
  const sampled = hours.filter(h => h.level !== null).length;
  const accessible = hours.map(h => `${hourText(h.hour)}: ${h.level === null ? 'sin datos' : `nivel ${h.level}, ${labels[h.status]}`}`).join('; ');
  return `<div class="manual-history"><div class="mini-heading"><span>${detail ? esc(day.date) : 'Hoy'} · ${sampled}/24 horas con reportes</span><span class="demo-tag">ESCALA 1–3</span></div><div class="report-plot"><div class="report-y" aria-hidden="true"><span>3</span><span>2</span><span>1</span></div><div><div class="chart report-chart ${detail ? 'detail-chart' : ''}" role="img" aria-label="${esc(accessible)}">${hours.map(h => `<span class="bar report-bar ${h.status || 'no-report'}" data-height="${h.level === null ? 0 : h.level / 3 * 100}" title="${esc(hourText(h.hour) + ': ' + (h.level === null ? 'Sin datos' : `${labels[h.status]} · nivel ${h.level} de 3`))}"></span>`).join('')}</div><div class="chart-hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>23 h</span></div></div></div><div class="report-legend"><span><i class="dot quiet"></i>1 Tranquilo</span><span><i class="dot medium"></i>2 Moderado</span><span><i class="dot busy"></i>3 Muy concurrido</span><span><i class="dot missing"></i>Sin datos</span></div>${detail ? `<p class="report-summary">${esc(manualSummary(gym, day.date))}</p><details class="report-table"><summary>Ver reportes por hora</summary><table><caption>Último reporte de cada hora · ${esc(day.date)} · República Dominicana</caption><thead><tr><th>Hora</th><th>Nivel reportado</th><th>Registrado a las</th></tr></thead><tbody>${hours.map(h => `<tr><td>${hourText(h.hour)}</td><td>${h.level === null ? 'Sin datos' : `${h.level}/3 · ${labels[h.status]}`}</td><td>${h.reportedAt ? esc(new Date(h.reportedAt).toLocaleTimeString('es-DO', {timeZone:'America/Santo_Domingo', hour:'2-digit', minute:'2-digit', hour12:false})) : '—'}</td></tr>`).join('')}</tbody></table></details>` : ''}</div>`;
}
export function manualHistoryPanel(gym, date) {
  const day = manualDay(gym, date);
  return `<div class="report-day-control"><label for="report-day">Reportes por hora</label><select id="report-day" aria-label="Día del historial">${(gym.reportHistory || []).map((d, i) => `<option value="${esc(d.date)}"${d.date === day.date ? ' selected' : ''}>${i === 0 ? 'Hoy · ' : ''}${esc(d.date)}</option>`).join('')}</select></div>${manualChart(gym, day.date, true)}<p class="history-disclaimer">Escala manual, sin porcentajes ni conteo de personas. Cada barra usa el último reporte guardado en esa hora; las horas sin reportes quedan sin datos. No es una predicción de horas pico.</p>`;
}
export function paintReportBars(root) {
  root.querySelectorAll('.report-bar[data-height]').forEach(bar => {
    bar.style.setProperty('--bar-height', `${Math.max(3, Math.min(100, Number(bar.dataset.height)))}%`);
  });
}
