// GET/POST with user bearer token -> server-authoritative access status (trial + handoff cap).
const { accessStatus, tokenOf } = require('./_access');
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('{"error":"method"}');
  try { const s = await accessStatus(tokenOf(req)); res.status(s.status).send(JSON.stringify(s.body)); }
  catch (e) { res.status(502).send('{"error":"upstream"}'); }
};
