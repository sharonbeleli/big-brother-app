// Big Brother non-AI dialogue engine. Pure: handle(text) -> {messages, chips, stage, progress, crisis?}
(function (root) {
  const isNode = typeof module !== "undefined";
  const BB = isNode ? require("./safety.js") : root.BB;
  const STAGES = ["welcome","acquaint","topic","questions","reflection","luck","closing","done"];
  const ANGER = ["מתפטר עכשיו","אתפטר עכשיו","אעזוב בטריקת","לטרוק את הדלת","אגיד לו מה אני חושב","אצעק עליו","אצעק עליה","אשלח לו הודעה","בא לי לשבור","אני רותח","עצבים","דפוק","מטומטם","מטומטמת","אידיוט","יא חרא","קוקסינל","שונא אותו","שונאת אותו","fuck","שיזדיין","שתזדיין","לך תזדיין"];
  const AT_BOT = ["בוט מטומטם","אתה מטומטם","אתה דפוק","אתה אידיוט","בוט דפוק","אתה חרא","לך תזדיין"];
  const DIRECTION = ["מה אתה חושב שאני צריך","מה לעשות","תגיד לי מה","מה כדאי לי","מה אתה ממליץ"];
  const VALIDATION = ["אתה חושב שזה נכון","זה הגיוני","טעיתי","צדקתי"];
  const MOTIV = ["רוצה","חייב","מנסה","שוב ושוב","לא מוותר","אעשה הכל","מת על"];
  const ABILITY = ["הצלחתי","יודע לעשות","ניסיון","קידמו אותי","הובלתי","בניתי","סיימתי"];
  const DONTKNOW = ["לא יודע","לא יודעת","אין לי מושג","לא בטוח","לא בטוחה","אולי"];
  const norm = s => String(s || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "").replace(/[!?.,"']/g, " ").replace(/\s+/g, " ").trim();
  const has = (t, list) => list.some(k => t.includes(norm(k)));
  const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;

  function Engine(opts) {
    opts = opts || {};
    this.C = opts.content; this.mem = opts.memory; this.now = opts.now || (() => Date.now());
    this.rnd = opts.random || Math.random; this.handoffCfg = opts.handoff || BB.HANDOFF;
    this.country = opts.country || "IL";
    this.s = { stage: "welcome", sub: null, topic: null, qi: 0, elab: 0, answers: {}, hist: [], dk: 0, locked: false, pendingAnger: false };
    this.hidden = { motivation: 0, ability: 0, style: null, personType: null }; // internal only
  }
  const P = Engine.prototype;
  P.pick = function (arr) { return Array.isArray(arr) ? arr[Math.floor(this.rnd() * arr.length) % arr.length] : arr; };
  P.fmt = function (t, v) { return String(t).replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : "")); };
  P.out = function (messages, chips) {
    const i = STAGES.indexOf(this.s.stage === "crisis" ? "done" : this.s.stage);
    return { messages, chips: chips || [], stage: this.s.stage, progress: Math.round((Math.max(i, 0) / (STAGES.length - 1)) * 100) };
  };
  P.profile = function () { return (this.mem && this.mem.load()) || {}; };
  P.topicChips = function () { const T = this.C.flows.topics; return Object.keys(T).map(k => ({ label: T[k].label, value: "topic:" + k })); };

  P.start = function () {
    const F = this.C.flows, p = this.profile(), m = [];
    if (p.name) {
      const days = p.lastVisit ? Math.floor((this.now() - p.lastVisit) / 864e5) : 0;
      m.push({ text: this.fmt(this.pick(days > 0 ? F.welcome_back : F.welcome_back_today), { name: p.name, days }) });
      m.push({ text: F.disclaimer, kind: "note" });
      this.mem.save({ sessions: (p.sessions || 0) + 1, lastVisit: this.now() });
      this.s.stage = "topic";
      m.push({ text: this.pick(F.ask_topic) });
      return this.out(m, this.topicChips());
    }
    m.push({ text: this.pick(F.welcome) }, { text: F.disclaimer, kind: "note" }, { text: this.pick(F.ask_name) });
    this.s.stage = "acquaint"; this.s.sub = "name";
    return this.out(m);
  };

  P.observe = function (t) {
    if (has(t, MOTIV)) this.hidden.motivation++;
    if (has(t, ABILITY)) this.hidden.ability++;
    if (has(t, DIRECTION)) this.hidden.style = "direction";
    else if (has(t, VALIDATION)) this.hidden.style = "validation";
    const h = this.hidden;
    h.personType = h.ability && h.motivation ? "ability+motivation" : h.ability ? "ability-only" : h.motivation ? "motivation-only" : null;
  };

  P.handle = function (input) {
    const raw = String(input || "").trim(); const F = this.C.flows;
    // 1) SAFETY FIRST – every message, every stage
    const c = BB.detectCrisis(raw);
    if (c.level > 0) {
      this.s.locked = true; this.s.stage = "crisis";
      return Object.assign(this.out([{ text: BB.crisisMessage(c.level, c.type), kind: "crisis" }]),
        { crisis: { level: c.level, type: c.type || "self", hotlines: BB.getHotlines(this.country) } });
    }
    if (this.s.locked) return Object.assign(this.out([{ text: F.locked }]), { crisis: { level: 0, reminder: true, hotlines: BB.getHotlines(this.country) } });
    const t = norm(raw);
    if (raw === "action:forget") { if (this.mem) this.mem.forget(); this.s = { stage: "welcome", answers: {}, hist: [], dk: 0, qi: 0, elab: 0 }; return Object.assign(this.start(), { forgotten: true }); }
    if (raw === "action:human") return this.handoff();
    if (raw === "action:new") { this.s.stage = "topic"; return this.out([{ text: this.pick(F.ask_topic) }], this.topicChips()); }
    this.observe(t);
    // 2) reverse empathy (not during acquaintance)
    if (this.s.stage !== "acquaint" && this.s.stage !== "welcome") {
      if (has(t, AT_BOT)) return this.out([{ text: this.pick(F.reverse_empathy_bot), kind: "empathy" }], this.chipsFor());
      if (has(t, ANGER) && !this.s.pendingAnger) {
        this.s.pendingAnger = true;
        return this.out([{ text: this.pick(F.reverse_empathy), kind: "empathy" }], this.chipsFor());
      }
      this.s.pendingAnger = false;
    }
    // 3) non-convergence (questions stages only)
    if (["questions","reflection","luck","closing"].includes(this.s.stage)) {
      this.s.hist.push(t);
      if (has(t, DONTKNOW) && words(raw) <= 3) this.s.dk++;
      const rep = this.s.hist.filter(x => x === t).length;
      if (this.s.dk >= 3 || (rep >= 3 && words(raw) > 0)) { this.s.dk = 0; this.s.hist = []; return this.handoff(true); }
    }
    return this["st_" + this.s.stage](raw, t);
  };

  P.chipsFor = function () { return []; };
  P.handoff = function (auto) {
    const F = this.C.flows; const user = { handoffs: this.profile().handoffs || this.handoffLog || [] };
    const r = BB.requestHandoff(user, this.now(), this.handoffCfg); this.handoffLog = user.handoffs;
    if (this.mem) this.mem.save({ handoffs: user.handoffs });
    const m = []; if (auto) m.push({ text: F.nonconverge });
    m.push({ text: r.message, kind: r.ok ? "handoff" : "note" });
    return Object.assign(this.out(m, r.ok ? [] : [{ label: "נמשיך כאן", value: "action:new" }]), { handoff: r });
  };

  P.st_welcome = function () { return this.start(); };
  P.st_acquaint = function (raw) {
    const F = this.C.flows, E = (isNode ? require("./memory.js") : root.BBMemory).ENUMS;
    const save = o => this.mem && this.mem.save(o);
    if (this.s.sub === "name") {
      const name = raw.replace(/^(קוראים לי|אני|שמי)\s+/, "").split(/\s+/)[0];
      if (!name) return this.out([{ text: this.pick(F.ask_name) }]);
      this.name = name; save({ name, sessions: 1, lastVisit: this.now() });
      this.s.sub = "age"; return this.out([{ text: this.fmt(this.pick(F.ask_age), { name }) }], E.ageRange.map(v => ({ label: v, value: v })));
    }
    if (this.s.sub === "age") { save({ ageRange: raw }); this.s.sub = "occ"; return this.out([{ text: this.pick(F.ask_occ) }], E.occupation.map(v => ({ label: v, value: v }))); }
    if (this.s.sub === "occ") { save({ occupation: raw }); this.s.sub = "city"; return this.out([{ text: this.pick(F.ask_city) }], [{ label: "דלג", value: "skip" }]); }
    if (this.s.sub === "city") { if (raw !== "skip") save({ city: raw }); this.s.stage = "topic"; return this.out([{ text: this.pick(F.ask_topic) }], this.topicChips()); }
  };
  P.st_topic = function (raw, t) {
    const F = this.C.flows; let k = raw.startsWith("topic:") ? raw.slice(6) : null;
    if (!k) for (const key of Object.keys(F.topics)) if (t.includes(norm(F.topics[key].label.split(" ")[0]))) k = key;
    if (!k || !F.topics[k]) return this.out([{ text: this.pick(F.ask_topic) }], this.topicChips());
    this.s.topic = k; this.s.qi = 0; this.s.elab = 0; this.s.answers = {}; this.s.stage = "questions";
    if (this.mem) this.mem.save({ lastTopic: k });
    return this.out([{ text: this.C.flows.topics[k].questions[0].t[0] }]);
  };
  P.st_questions = function (raw) {
    const F = this.C.flows, Q = F.topics[this.s.topic].questions;
    if (words(raw) < 4 && this.s.elab < 2) { this.s.elab++; return this.out([{ text: F.elaborate[(this.s.elab - 1) % F.elaborate.length] }]); }
    const q = Q[this.s.qi]; this.s.answers[q.id] = ((this.s.answers[q.id] || "") + " " + raw).trim(); // session-only, never persisted
    this.s.qi++; this.s.elab = 0;
    if (this.s.qi < Q.length) {
      const m = []; if (this.rnd() < 0.5) m.push({ text: this.pick(F.ack) });
      m.push({ text: this.pick(Q[this.s.qi].t) }); return this.out(m);
    }
    this.s.stage = "reflection";
    const a = this.analogy(), m = [{ text: this.pick(F.topics[this.s.topic].insight), kind: "insight" }];
    if (a) m.push({ text: this.pick(F.analogy_intro) + " " + a.analogy, kind: "analogy", caseId: a.id });
    m.push({ text: this.pick(F.insight_followup) });
    return Object.assign(this.out(m, [{ label: "כן, מתאים", value: "כן זה מתאים לי, זה באמת מה שקורה" }, { label: "לא בדיוק", value: "לא בדיוק, אצלי זה קצת אחרת" }]), { analogyCase: a && a.id });
  };
  P.analogy = function () {
    const text = norm(Object.values(this.s.answers).join(" ")); let best = null, bs = -1;
    for (const c of this.C.cases) { let s = c.topics.includes(this.s.topic) ? 2 : 0; for (const k of c.keywords) if (text.includes(norm(k))) s++; if (s > bs) { bs = s; best = c; } }
    return bs > 0 ? best : null;
  };
  P.st_reflection = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 4 && this.s.elab < 2) { this.s.elab++; return this.out([{ text: this.pick(F.elaborate) }]); }
    this.s.elab = 0; this.s.stage = "luck"; return this.out([{ text: this.pick(F.luck), kind: "insight" }]);
  };
  P.st_luck = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 3 && this.s.elab < 2) { this.s.elab++; return this.out([{ text: this.pick(F.elaborate) }]); }
    this.s.elab = 0; this.action = raw; this.s.stage = "closing";
    const style = this.hidden.style || (this.profile().preferredStyle) || "validation";
    return this.out([{ text: this.pick(style === "direction" ? F.ask_conclusion_direction : F.ask_conclusion_validation) }]);
  };
  P.st_closing = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 3 && this.s.elab < 2) { this.s.elab++; return this.out([{ text: this.pick(F.elaborate) }]); }
    this.s.stage = "done";
    if (this.mem && this.hidden.style) this.mem.save({ preferredStyle: this.hidden.style });
    const m = [{ text: this.fmt(this.pick(F.closing), { conclusion: raw, action: this.action }), kind: "summary" }];
    if (this.s.topic === "career") m.push({ text: F.closing_execution });
    m.push({ text: F.human_offer + " " + this.pick(F.done) });
    return this.out(m, [{ label: "נושא חדש", value: "action:new" }, { label: "לדבר עם בן אדם", value: "action:human" }]);
  };
  P.st_done = function () { return this.out([{ text: this.pick(this.C.flows.done) }], [{ label: "נושא חדש", value: "action:new" }, { label: "לדבר עם בן אדם", value: "action:human" }]); };
  P.st_crisis = function () { return this.out([{ text: this.C.flows.locked }]); };

  const api = { Engine, STAGES };
  if (isNode) module.exports = api; else root.BBEngine = api;
})(this);
