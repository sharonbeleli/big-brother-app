// POST with user bearer token: returns own profile; promotes to admin if email is in ADMIN_EMAILS (comma-separated).
const U = () => process.env.SUPABASE_URL, SR = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const sh = () => ({ apikey: SR(), Authorization: 'Bearer ' + SR(), 'Content-Type': 'application/json' });
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('{"error":"method"}');
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok) return res.status(401).send('{"error":"auth"}');
  const ur = await fetch(U() + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok } });
  if (!ur.ok) return res.status(401).send('{"error":"auth"}');
  const user = await ur.json();
  const base = U() + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id);
  let p = (await (await fetch(base + '&select=*', { headers: sh() })).json())[0];
  if (!p) { await fetch(U() + '/rest/v1/profiles', { method: 'POST', headers: Object.assign(sh(), { Prefer: 'resolution=ignore-duplicates' }), body: JSON.stringify({ id: user.id, email: user.email }) });
    p = (await (await fetch(base + '&select=*', { headers: sh() })).json())[0]; }
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (p && !p.is_admin && user.email && user.email_confirmed_at && admins.includes(user.email.toLowerCase())) {
    const r = await fetch(base, { method: 'PATCH', headers: Object.assign(sh(), { Prefer: 'return=representation' }), body: JSON.stringify({ is_admin: true }) });
    p = (await r.json())[0] || p;
  }
  res.status(200).send(JSON.stringify({ profile: p ? { id: p.id, is_admin: p.is_admin, trial_started_at: p.trial_started_at, trial_days: p.trial_days, onboarding_done: p.onboarding_done, onboarding: p.onboarding } : null }));
};
