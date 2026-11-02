// Provider-agnostic payments core. NO real charges in this codebase:
//  - PAYMENTS_MODE unset/'off' -> everything disabled, UI shows 'בקרוב'.
//  - PAYMENTS_MODE='mock'      -> simulated checkout (no card fields, no money), writes via service role RPC bb_apply_payment (is_test=true).
//  - Real providers implement the same adapter interface later (see PROVIDERS.paddle stub) and are never enabled by this code.
const crypto = require('crypto');
const U = () => process.env.SUPABASE_URL, SR = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const mode = () => (process.env.PAYMENTS_MODE || 'off').toLowerCase();
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
// Prices are placeholders for the simulation only (agorot). Override via env; final prices TBD by the owner.
const products = () => ({
  monthly: { id: 'monthly', kind: 'subscription', label: 'מנוי חודשי', amount: num(process.env.PRICE_MONTHLY_AGOROT, 3900), currency: 'ILS', period_days: 30, qty: 1 },
  session: { id: 'session', kind: 'session_credits', label: 'שיחה עם אח גדול (חד־פעמי)', amount: num(process.env.PRICE_SESSION_AGOROT, 8900), currency: 'ILS', qty: 1 }
});
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Adapter interface: { name, enabled(), checkout({user, product, idem}) -> {kind:'applied'|'redirect', ...}, verifyWebhook(raw, headers) -> normalized event | null }
// Normalized event: { type: 'payment.succeeded'|'subscription.canceled', user_id, ref, kind, qty, amount, currency, period_days, is_test }
const PROVIDERS = {
  mock: {
    name: 'mock',
    enabled: () => mode() === 'mock',
    async checkout({ user, product, idem }) {
      const ref = 'mock_' + user.id.slice(0, 8) + '_' + idem;
      const r = await applyPayment({ user_id: user.id, provider: 'mock', ref, kind: product.kind, qty: product.qty, amount: product.amount, currency: product.currency, period_days: product.period_days, is_test: true });
      return { kind: 'applied', ref, result: r };
    },
    // Test-only webhook: HMAC-SHA256(raw body, PAYMENTS_WEBHOOK_SECRET) in header x-bb-signature (hex).
    verifyWebhook(raw, headers) {
      const sec = process.env.PAYMENTS_WEBHOOK_SECRET; if (!sec) return null;
      const sig = String(headers['x-bb-signature'] || '');
      const exp = crypto.createHmac('sha256', sec).update(raw).digest('hex');
      if (!sig || !safeEq(sig, exp)) return null;
      let e; try { e = JSON.parse(raw); } catch (_) { return null; }
      return Object.assign({}, e, { is_test: true });
    }
  },
  // Placeholder for the recommended real MoR (Paddle). Intentionally NOT implemented and never enabled.
  // To implement later: Paddle-Signature header 'ts=..;h1=..' = HMAC-SHA256(secret, ts + ':' + raw), map transaction.completed /
  // subscription.activated|canceled to the normalized event, user id via custom_data.user_id, ref = transaction/subscription id.
  paddle: {
    name: 'paddle',
    enabled: () => false,
    async checkout() { throw new Error('paddle_not_implemented'); },
    verifyWebhook() { return null; }
  }
};
const provider = () => mode() === 'mock' ? PROVIDERS.mock : null;

const sh = () => ({ apikey: SR(), Authorization: 'Bearer ' + SR(), 'Content-Type': 'application/json' });
async function applyPayment(e) {
  const r = await fetch(U() + '/rest/v1/rpc/bb_apply_payment', { method: 'POST', headers: sh(), body: JSON.stringify({
    p_user: e.user_id, p_provider: e.provider, p_ref: e.ref, p_kind: e.kind, p_qty: e.qty || 1, p_amount: e.amount || 0, p_currency: e.currency || 'ILS', p_is_test: e.is_test !== false, p_period_days: e.kind === 'subscription' ? (e.period_days || 30) : null }) });
  if (!r.ok) throw new Error('apply_failed_' + r.status);
  return r.json();
}
async function cancelSub(provider, ref) {
  const r = await fetch(U() + '/rest/v1/rpc/bb_cancel_subscription', { method: 'POST', headers: sh(), body: JSON.stringify({ p_provider: provider, p_ref: ref }) });
  if (!r.ok) throw new Error('cancel_failed_' + r.status); return r.json();
}
async function getUser(token) {
  if (!token) return null;
  const r = await fetch(U() + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null; const u = await r.json(); return u && u.id ? u : null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_EVENT = e => e && UUID.test(String(e.user_id)) && /^[\w.:-]{1,200}$/.test(String(e.ref || '')) &&
  (e.type === 'subscription.canceled' || (e.type === 'payment.succeeded' && ['subscription', 'session_credits'].includes(e.kind) && (!e.qty || (e.qty >= 1 && e.qty <= 50))));
module.exports = { mode, products, PROVIDERS, provider, applyPayment, cancelSub, getUser, UUID, VALID_EVENT };
