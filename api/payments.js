// GET  -> payment mode + products (public, no secrets).
// POST {product, idem} with user bearer token -> mock checkout (PAYMENTS_MODE=mock only). Auth required, NOT gated by requireActive (expired users must be able to pay).
const P = require('./_payments');
const { tokenOf } = require('./_access');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const prov = P.provider(); const prods = P.products();
  if (req.method === 'GET') return res.status(200).send(JSON.stringify({ mode: P.mode(), enabled: !!prov, test: P.mode() === 'mock', products: Object.values(prods).map(p => ({ id: p.id, kind: p.kind, label: p.label, amount: p.amount, currency: p.currency })) }));
  if (req.method !== 'POST') return res.status(405).send('{"error":"method"}');
  try {
    const user = await P.getUser(tokenOf(req)); if (!user) return res.status(401).send('{"error":"auth"}');
    if (!prov) return res.status(503).send('{"error":"payments_disabled"}');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const product = prods[b.product]; if (!product) return res.status(400).send('{"error":"product"}');
    if (!P.UUID.test(String(b.idem || ''))) return res.status(400).send('{"error":"idem"}');
    const out = await prov.checkout({ user, product, idem: b.idem.toLowerCase() });
    res.status(200).send(JSON.stringify({ ok: true, test: true, product: product.id, duplicate: !!(out.result && out.result.duplicate) }));
  } catch (e) { console.error('payments: checkout failed', String(e && e.message || e).slice(0, 80)); res.status(502).send('{"error":"upstream"}'); }
};
