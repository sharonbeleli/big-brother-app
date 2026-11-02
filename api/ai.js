// POST /api/ai – auth + trial (requireActive) + rate limit + OpenAI (server-side key). See _ai-core.js.
module.exports = (req, res) => require('./_ai-core.js').handle(req, res);
