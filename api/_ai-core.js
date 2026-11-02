// AI layer core (server-side only). Never logs message text, never persists conversation content.
// The client runs its own rule-based crisis layer FIRST; this endpoint can only ESCALATE (crisis>0), never de-escalate.
const PROMPTS = require('./_prompts.js');
const CFG = {
  small: () => process.env.AI_MODEL_SMALL || 'gpt-6-luna',
  strong: () => process.env.AI_MODEL_STRONG || 'gpt-6.1-terra',
  maxOut: { turn: 300, insight: 500 },     // hard cap on output tokens per call
  maxMsgChars: 600, maxMsgs: 12, timeoutMs: 12000,
  rate: { perMin: 8, perDay: 120, insightPerDay: 10 }
};
const PROFILE_KEYS = ['name', 'ageRange', 'occupation', 'tone', 'length']; // general details only
const STAGES = ['topic', 'questions', 'reflection', 'luck', 'closing', 'done'];
const UNDERSTAND = ['short', 'answer', 'off_topic', 'anger', 'dont_know', 'question_to_bot'];
const PTYPES = ['ability+motivation', 'ability-only', 'motivation-only'];

// --- in-memory rate limiter (per warm serverless instance; best-effort) ---
const buckets = new Map();
function rateLimit(uid, mode, now) {
  const day = Math.floor(now / 864e5), min = Math.floor(now / 6e4);
  let b = buckets.get(uid);
  if (!b || b.day !== day) b = { day, min, m: 0, d: 0, ins: 0 };
  if (b.min !== min) { b.min = min; b.m = 0; }
  if (b.m >= CFG.rate.perMin || b.d >= CFG.rate.perDay || (mode === 'insight' && b.ins >= CFG.rate.insightPerDay)) { buckets.set(uid, b); return false; }
  b.m++; b.d++; if (mode === 'insight') b.ins++; buckets.set(uid, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return true;
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
function sanitize(body) {
  body = body && typeof body === 'object' ? body : {};
  const mode = body.mode === 'insight' ? 'insight' : 'turn';
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-CFG.maxMsgs)
    .map(m => ({ role: m && m.role === 'bot' ? 'bot' : 'user', text: str(m && m.text, CFG.maxMsgChars) })).filter(m => m.text);
  const p = body.profile && typeof body.profile === 'object' ? body.profile : {}, profile = {};
  for (const k of PROFILE_KEYS) if (typeof p[k] === 'string' && p[k]) profile[k] = str(p[k], 30);
  return { mode, msgs, profile, planned: str(body.planned, 400), stage: STAGES.includes(body.stage) ? body.stage : 'questions', topic: str(body.topic, 20).replace(/[^a-z_]/g, '') };
}
function buildInput(s) {
  const conv = s.msgs.map(m => (m.role === 'bot' ? 'בוט: ' : 'משתמש: ') + m.text).join('\n');
  return 'פרופיל כללי: ' + JSON.stringify(s.profile) + '\nנושא: ' + s.topic + '\nשלב: ' + s.stage +
    (s.mode === 'turn' ? '\nplanned: ' + s.planned : '') + '\n--- שיחה ---\n' + conv + '\n--- החזר JSON בלבד ---';
}
function outText(j) {
  if (typeof j.output_text === 'string') return j.output_text;
  for (const o of j.output || []) for (const c of o.content || []) if (c.type === 'output_text' && c.text) return c.text;
  return '';
}
async function callOpenAI(fetchFn, model, instructions, input, maxOut, extra) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), CFG.timeoutMs);
  try {
    const r = await fetchFn('https://api.openai.com/v1/responses', { method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ model, instructions, input, max_output_tokens: maxOut, store: false, text: { format: { type: 'json_object' } } }, extra || {})) });
    if (!r.ok) { let c = ''; try { const e = await r.json(); c = (e.error && (e.error.code || e.error.param || e.error.type)) || ''; } catch (x) {} return { error: 'openai_' + r.status + (c ? ':' + String(c).slice(0, 60) : '') }; }
    const j = await r.json();
    let data; try { data = JSON.parse(outText(j)); } catch (e) { return { error: 'bad_json', usage: j.usage }; }
    return { data, usage: j.usage ? { input_tokens: j.usage.input_tokens, output_tokens: j.usage.output_tokens } : null };
  } catch (e) { return { error: 'timeout_or_network' }; } finally { clearTimeout(t); }
}
function subOf(tok) { try { return String(JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub || tok.slice(-24)); } catch (e) { return tok.slice(-24); } }
const lvl = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : 0; };
// Normalise model output. Crisis is monotonic: any parse problem => crisis stays 0 here, but the CLIENT keeps its own rule verdict.
function shapeTurn(d) {
  const crisis = lvl(d.crisis);
  return { crisis, understanding: UNDERSTAND.includes(d.understanding) ? d.understanding : null,
    converging: typeof d.converging === 'boolean' ? d.converging : null,
    person_type: PTYPES.includes(d.person_type) ? d.person_type : null,
    reply: crisis ? '' : str(d.reply, 400).trim() };
}
function shapeInsight(d) { const crisis = lvl(d.crisis); return { crisis, insight: crisis ? '' : str(d.insight, 700).trim() }; }

async function handle(req, res, deps) {
  deps = deps || {};
  const fetchFn = deps.fetch || fetch, requireActive = deps.requireActive || require('./_access.js').requireActive, now = (deps.now || Date.now)();
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).send('{"error":"method"}'); return; }
  const st = await requireActive(req, res); if (!st) return;      // 401 auth / 402 trial_expired already written
  const uid = subOf(require('./_access.js').tokenOf(req)); // JWT already verified by Supabase in requireActive()
  if (!process.env.OPENAI_API_KEY) { res.status(503).send('{"error":"ai_unconfigured"}'); return; }
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const s = sanitize(body);
  if (!s.msgs.length) { res.status(400).send('{"error":"empty"}'); return; }
  if (!rateLimit(uid, s.mode, now)) { res.status(429).send('{"error":"rate_limited"}'); return; }
  const input = buildInput(s);
  const r = s.mode === 'insight'
    ? await callOpenAI(fetchFn, CFG.strong(), PROMPTS.insight, input, CFG.maxOut.insight)
    : await callOpenAI(fetchFn, CFG.small(), PROMPTS.turn, input, CFG.maxOut.turn, { reasoning: { effort: 'low' } });
  if (r.error) { console.warn('ai_error', r.error); res.status(502).send(JSON.stringify({ error: 'ai_failed' })); return; } // no content logged
  const out = s.mode === 'insight' ? shapeInsight(r.data) : shapeTurn(r.data);
  res.status(200).send(JSON.stringify(Object.assign({ ok: true, mode: s.mode, model: s.mode === 'insight' ? CFG.strong() : CFG.small(), usage: r.usage }, out)));
}
module.exports = { handle, sanitize, rateLimit, shapeTurn, shapeInsight, buildInput, CFG, _buckets: buckets };
