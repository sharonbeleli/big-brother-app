// Shared server-side access check. Future AI/server endpoints MUST call requireActive() before doing paid work.
// Source of truth: SQL RPC public.access_status() (security definer, computed from profiles.trial_* + admin extensions).
// It runs with the caller's own JWT, so a user can only ever see their own status.
const U = () => process.env.SUPABASE_URL, A = () => process.env.SUPABASE_ANON_KEY;
async function accessStatus(token) {
  if (!token) return { status: 401, body: { error: 'auth' } };
  const r = await fetch(U() + '/rest/v1/rpc/access_status', { method: 'POST',
    headers: { apikey: A(), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
  if (r.status === 401 || r.status === 403) return { status: 401, body: { error: 'auth' } };
  if (!r.ok) return { status: 502, body: { error: 'upstream' } };
  return { status: 200, body: await r.json() };
}
const tokenOf = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
// Returns the status object if active, otherwise writes the error response and returns null.
// NOTE: crisis/safety responses must never be routed through this gate.
async function requireActive(req, res) {
  const s = await accessStatus(tokenOf(req));
  if (s.status !== 200) { res.status(s.status).send(JSON.stringify(s.body)); return null; }
  if (!s.body.active) { res.status(402).send(JSON.stringify({ error: 'trial_expired', status: s.body })); return null; }
  return s.body;
}
module.exports = { accessStatus, requireActive, tokenOf };
