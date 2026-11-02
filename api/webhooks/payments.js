// POST /api/webhooks/payments - provider webhook. Signature verified by the active adapter; 503 while payments are disabled.
// Idempotent: bb_apply_payment dedupes on (provider, provider_ref).
const P = require('../_payments');
const readRaw = req => new Promise((ok, no) => { if (typeof req.body === 'string') return ok(req.body); if (Buffer.isBuffer(req.body)) return ok(req.body.toString('utf8'));
  let d = ''; req.on('data', c => { d += c; if (d.length > 65536) no(new Error('too_big')); }); req.on('end', () => ok(d)); req.on('error', no); });
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('{"error":"method"}');
  const prov = P.provider(); if (!prov) return res.status(503).send('{"error":"payments_disabled"}');
  let raw; try { raw = await readRaw(req); } catch (e) { return res.status(413).send('{"error":"body"}'); }
  if (!raw && req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
  const ev = prov.verifyWebhook(raw || '', req.headers || {});
  if (!ev) return res.status(401).send('{"error":"signature"}');
  if (!P.VALID_EVENT(ev)) return res.status(400).send('{"error":"event"}');
  try {
    if (ev.type === 'subscription.canceled') await P.cancelSub(prov.name, ev.ref);
    else { const pr = P.products()[ev.kind === 'subscription' ? 'monthly' : 'session'];
      await P.applyPayment({ user_id: ev.user_id, provider: prov.name, ref: ev.ref, kind: ev.kind, qty: ev.qty || 1, amount: ev.amount || 0, currency: ev.currency || 'ILS', period_days: pr.period_days, is_test: ev.is_test !== false }); }
    res.status(200).send('{"ok":true}');
  } catch (e) { console.error('webhook: apply failed', String(e && e.message || e).slice(0, 80)); res.status(500).send('{"error":"apply"}'); }
};
