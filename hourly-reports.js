export const reportLevels = Object.freeze({ quiet: 1, medium: 2, busy: 3 });
const localTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export function reportTime(timestamp) {
  const parts = Object.fromEntries(localTime.formatToParts(new Date(Number(timestamp))).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
export function reportDays(timestamp = Date.now()) {
  const today = reportTime(timestamp).date;
  const midday = Date.parse(today + 'T12:00:00Z');
  return Array.from({ length: 7 }, (_, i) => new Date(midday - i * 86400000).toISOString().slice(0, 10));
}
export function reportHistory(rows = [], days = reportDays()) {
  const byHour = new Map(rows.map(row => [`${row.report_date}:${Number(row.report_hour)}`, row]));
  return days.map(date => ({ date, hours: Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(`${date}:${hour}`);
    return { hour, level: row ? reportLevels[row.status] : null, status: row?.status || null, reportedAt: row ? new Date(Number(row.reported_at)).toISOString() : null };
  }) }));
}
