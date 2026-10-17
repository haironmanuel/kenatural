export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
export const LISTING_PLAN = Object.freeze({
  amount: 159900, currency: 'DOP', interval: 'month', trialDays: 7,
  displayPrice: 'RD$1,599', paymentsAvailable: false,
});

export function listingSubscription(row, now = Date.now()) {
  const trialEnd = Number(row.trial_ends_at || 0);
  const paidUntil = Number(row.paid_until || 0);
  const active = paidUntil > now;
  const trialing = !active && trialEnd > now;
  return {
    status: active ? 'active' : trialing ? 'trialing' : 'expired',
    visible: active || trialing,
    trialEndsAt: trialEnd ? new Date(trialEnd).toISOString() : null,
    paidThrough: paidUntil ? new Date(paidUntil).toISOString() : null,
    trialDaysRemaining: Math.max(0, Math.ceil((trialEnd - now) / 86400000)),
    paymentsAvailable: false,
  };
}
