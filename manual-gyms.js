import { listingSubscription } from './subscriptions.js';
export const manualStatuses = ['quiet', 'medium', 'busy'];
export function ownedGym(row) {
  return { ...manualGym(row), subscription: listingSubscription(row) };
}
export function manualGym(row) {
  return {
    id: row.id, name: row.name, city: row.city, area: row.area,
    manual: true, demo: false, manualStatus: row.status,
    observedAt: new Date(Number(row.updated_at)).toISOString(),
    source: 'Reporte manual de un usuario · Sin verificar',
    capacity: null, people: null, hourly: [],
  };
}
export function gymFields(body) {
  const fields = {};
  for (const [key, min, max] of [['name', 2, 100], ['city', 2, 80], ['area', 2, 100]]) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (value.length < min || value.length > max) return null;
    fields[key] = value;
  }
  if (!manualStatuses.includes(body.status)) return null;
  return { ...fields, status: body.status };
}
