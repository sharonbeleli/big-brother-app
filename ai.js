// Client AI orchestration. ORDER: rule engine (incl. client crisis layer) runs first in eng.handle();
// this only runs on non-crisis results, can only ESCALATE to crisis, and on any failure returns the rule result unchanged.
(function (root) {
  const isNode = typeof module !== "undefined";
  const BB = () => (isNode ? require("./safety.js") : root.BB);
  const SKIP_STAGES = ["welcome", "acquaint", "crisis"];
  const NONCONV_LIMIT = 3;
  function withTimeout(p, ms) { return Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]); }
  function profileOf(eng) { const p = (eng.mem && eng.mem.load && eng.mem.load()) || {}; const o = {};
    for (const k of ["name", "ageRange", "occupation"]) if (p[k]) o[k] = String(p[k]); return o; }
  function hist(eng) { return eng.aiHist || (eng.aiHist = []); }
  function remember(eng, role, text) { const h = hist(eng); h.push({ role, text: String(text).slice(0, 600) }); if (h.length > 12) h.splice(0, h.length - 12); }
  function escalate(eng, level) {
    const B = BB(); eng.s.locked = true; eng.s.stage = "crisis";
    return Object.assign(eng.out([{ text: B.crisisMessage(level, "self"), kind: "crisis" }]),
      { crisis: { level, type: "self", source: "ai", hotlines: B.getHotlines(eng.country) } });
  }
  // r = rule-engine result for userText. call(body) -> Promise<json|null>. Never throws.
  async function enhance(eng, userText, r, call, opts) {
    opts = opts || {}; const ms = opts.timeoutMs || 9000;
    try {
      if (!call || !r || r.crisis || eng.s.locked) return r;            // rule crisis always wins, untouched
      const v = String(userText || "");
      if (/^(action|topic):/.test(v) || r.handoff || SKIP_STAGES.includes(r.stage)) { return r; }
      remember(eng, "user", v);
      const planned = r.messages.map(m => m.text).join("\n");
      const base = { messages: hist(eng).slice(), profile: profileOf(eng), stage: r.stage, topic: eng.s.topic || "" };
      const insightStep = r.messages.some(m => m.kind === "insight") && r.stage === "reflection";
      const [t, ins] = await Promise.all([
        withTimeout(Promise.resolve(call(Object.assign({ mode: "turn", planned }, base))).catch(() => null), ms),
        insightStep ? withTimeout(Promise.resolve(call(Object.assign({ mode: "insight" }, base))).catch(() => null), ms + 4000) : null
      ]);
      // Second crisis layer: escalate only (max of levels), never de-escalate.
      const lv = Math.max(t && t.ok ? Number(t.crisis) || 0 : 0, ins && ins.ok ? Number(ins.crisis) || 0 : 0);
      if (lv > 0) return escalate(eng, Math.min(3, lv));
      let out = r;
      if (t && t.ok) {
        if (t.person_type) eng.hidden.aiPersonType = t.person_type;    // internal only, never shown
        eng.aiNonConv = t.converging === false ? (eng.aiNonConv || 0) + 1 : 0;
        if (eng.aiNonConv >= NONCONV_LIMIT && ["questions", "reflection", "luck", "closing"].includes(r.stage)) {
          eng.aiNonConv = 0; out = Object.assign(eng.handoff(true), { aiHandoff: true });
        } else if (t.reply && !insightStep) {
          const msgs = r.messages.slice(), i = msgs.length - 1;
          if (i >= 0 && !msgs[i].kind && msgs[i].text !== BB().ELABORATE) { msgs[i] = Object.assign({}, msgs[i], { text: t.reply, ai: true }); out = Object.assign({}, r, { messages: msgs }); }
        }
      }
      if (out === r && ins && ins.ok && ins.insight) {
        const msgs = r.messages.map(m => m.kind === "insight" ? Object.assign({}, m, { text: ins.insight, ai: true }) : m);
        out = Object.assign({}, r, { messages: msgs });
      }
      for (const m of out.messages) remember(eng, "bot", m.text);
      return out;
    } catch (e) { return r; }
  }
  const api = { enhance, NONCONV_LIMIT };
  if (isNode) module.exports = api; else root.BBAI = api;
})(this);
