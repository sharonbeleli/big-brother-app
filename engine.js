// Big Brother non-AI dialogue engine. Pure: handle(text) -> {messages, chips, stage, progress, crisis?}
(function (root) {
  const isNode = typeof module !== "undefined";
  const BB = isNode ? require("./safety.js") : root.BB;
  const QA = isNode ? require("./qa.js") : root.BBQA;
  const RESCUE = ["בוא ננסה מזווית אחרת: מה הכי חשוב לך שיקרה פה?", "רגע, מה החלק הכי קשה בזה בשבילך?", "תן לי דוגמה אחת מהזמן האחרון?", "אם היית בוחר דבר אחד לטפל בו קודם – מה הוא?"];
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
  // whole-word match (optional one-letter Hebrew prefix) – avoids "אח" matching slang "אחי", "חבר" inside "חברה" etc.
  const hasWord = (t, w) => new RegExp("(^|\\s)[ובלהשמכ]?" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)").test(t);
  const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;

  function Engine(opts) {
    opts = opts || {};
    this.C = opts.content; this.mem = opts.memory; this.now = opts.now || (() => Date.now());
    this.rnd = opts.random || Math.random; this.handoffCfg = opts.handoff || BB.HANDOFF;
    this.country = opts.country || "IL";
    this.s = { stage: "welcome", sub: null, topic: null, qi: 0, elab: 0, answers: {}, hist: [], dk: 0, locked: false, pendingAnger: false };
    this.used = {}; this.sent = new Set(); this.qaUsed = {}; this.tplLog = []; this.moves = []; this.lastMove = null; this.turns = [];
    this.hidden = { motivation: 0, ability: 0, style: null, personType: null }; // internal only
  }
  const P = Engine.prototype;
  // Session-aware picker: never reuse a template until all variants of that slot are exhausted; never repeat the last one.
  P.pick = function (arr) {
    if (!Array.isArray(arr)) return arr; const key = arr[0];
    const u = this.used[key] || (this.used[key] = { seen: [], last: -1 });
    let avail = arr.map((_, i) => i).filter(i => !u.seen.includes(i) && !this.wasSent(arr[i]));
    if (!avail.length) avail = arr.map((_, i) => i).filter(i => !this.wasSent(arr[i])); // anti-repetition: never re-send a line already shown
    if (!avail.length) { u.seen = []; avail = arr.map((_, i) => i).filter(i => i !== u.last || arr.length === 1); }
    const idx = avail[Math.floor(this.rnd() * avail.length) % avail.length];
    u.seen.push(idx); u.last = idx; this.tplLog.push(key + "#" + idx); return arr[idx];
  };
  P.rint = function (n) { return Math.floor(this.rnd() * n) % n; };
  P.myName = function () { return this.name || this.profile().name || ""; };
  P.fmt = function (t, v) {
    v = Object.assign({}, v || {}); const n = this.myName();
    if (v.name_ == null) v.name_ = n && this.rnd() < 0.5 ? n + ", " : "";
    return String(t).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ""));
  };
  // Anti-repetition (conversation-wide): a line already sent is never sent again (crisis/notes/handoff exempt).
  P.wasSent = function (t) { return typeof t === "string" && this.sent.has(norm(t)); };
  P.markSent = function (t) { if (t) this.sent.add(norm(t)); };
  P.freshOf = function (arr) { return (arr || []).filter(x => !this.wasSent(x)); };
  P.rescue = function () {
    const pool = this.freshOf(((this.C.qa && this.C.qa.rescue) || []).concat(RESCUE));
    return pool.length ? pool[this.rint(pool.length)] : null;
  };
  P.out = function (messages, chips) {
    if (this.s.stage !== "crisis") {
      const EX = ["note", "handoff", "crisis"], keep = messages.filter(m => EX.includes(m.kind) || !this.wasSent(m.text));
      if (keep.length < messages.length && !keep.some(m => !EX.includes(m.kind))) { const r = this.rescue(); keep.push(r ? { text: r } : messages[messages.length - 1]); }
      messages = keep;
    }
    for (const m of messages) this.markSent(m.text);
    this.turns.push(messages.map(m => m.text).join("\n"));
    const i = STAGES.indexOf(this.s.stage === "crisis" ? "done" : this.s.stage === "qa" ? "questions" : this.s.stage);
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
    const t = norm(raw); this.lastRaw = raw;
    if (raw === "action:forget") { if (this.mem) this.mem.forget(); this.s = { stage: "welcome", answers: {}, hist: [], dk: 0, qi: 0, elab: 0 }; return Object.assign(this.start(), { forgotten: true }); }
    if (raw === "action:human") return this.handoff();
    if (raw === "action:new") { this.s.stage = "topic"; this.s.qaIntent = null; return this.out([{ text: this.pick(F.ask_topic) }], this.topicChips()); }
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
    // 3) Q&A knowledge base: confident match -> curated answer + follow-up. Miss -> flag for AI (qaMiss), rule flow continues as fallback.
    const qa = this.tryQA(raw);
    if (qa) return qa;
    const free = !!(this.C.qa && QA) && !/^(action|topic|skip$)/.test(raw) && words(raw) >= 1 && this.s.stage !== "acquaint";
    // 4) non-convergence (questions stages only)
    if (["questions","reflection","luck","closing"].includes(this.s.stage)) {
      this.s.hist.push(t);
      if (has(t, DONTKNOW) && words(raw) <= 3) this.s.dk++;
      const rep = this.s.hist.filter(x => x === t).length;
      if (this.s.dk >= 3 || (rep >= 3 && words(raw) > 0)) { this.s.dk = 0; this.s.hist = []; return this.handoff(true); }
    }
    const res = this["st_" + this.s.stage](raw, t);
    return free && res && !res.crisis && !res.handoff ? Object.assign(res, { qaMiss: true }) : res;
  };
  P.tryQA = function (raw) {
    const kb = this.C.qa, st = this.s.stage;
    if (!kb || !QA || !["topic", "qa", "done", "questions"].includes(st) || /^(action|topic):/.test(raw) || words(raw) < 2) return null;
    const m = QA.match(kb, raw, st === "questions" ? { threshold: (kb.threshold || 0.45) + 0.2 } : undefined); // mid-questionnaire: only clear new dilemmas
    if (!m) return null;
    if (st === "qa" && this.s.qaIntent && m.intent.id !== this.s.qaIntent && m.score < 0.75) return null; // stay in context unless clearly a new subject
    const it = m.intent, u = this.qaUsed[it.id] || (this.qaUsed[it.id] = { a: [], f: [] });
    const fa = it.answers.map((_, i) => i).filter(i => !u.a.includes(i) && !this.wasSent(it.answers[i]));
    if (!fa.length) return null;                                   // every curated answer already used -> let AI analyse
    const ai = fa[this.rint(fa.length)]; u.a.push(ai);
    const msgs = [{ text: it.answers[ai], kind: "qa" }];
    const ff = (it.followups || []).map((_, i) => i).filter(i => !u.f.includes(i) && !this.wasSent(it.followups[i]));
    if (ff.length) { const fi = ff[this.rint(ff.length)]; u.f.push(fi); msgs.push({ text: it.followups[fi] }); }
    if (st !== "questions" || this.s.qaIntent) this.s.topic = this.C.flows.topics[it.topic] ? it.topic : "other";
    this.s.stage = "qa"; this.s.qaIntent = it.id; this.s.elab = 0;
    return Object.assign(this.out(msgs, [{ label: "נושא חדש", value: "action:new" }, { label: "לדבר עם בן אדם", value: "action:human" }]), { qa: { intent: it.id, score: m.score } });
  };
  // In Q&A mode with no confident match: next unused follow-up of the current intent; when exhausted, enter the guided questionnaire.
  P.st_qa = function (raw) {
    const kb = this.C.qa, it = kb && (kb.intents || []).find(x => x.id === this.s.qaIntent);
    if (it) { const u = this.qaUsed[it.id] || (this.qaUsed[it.id] = { a: [], f: [] });
      const ff = (it.followups || []).map((_, i) => i).filter(i => !u.f.includes(i) && !this.wasSent(it.followups[i]));
      if (ff.length && words(raw) >= 2) { const fi = ff[this.rint(ff.length)]; u.f.push(fi); const ack = this.freshOf(["אוקיי.", "הבנתי.", "שומע אותך.", "אוקיי, זה מוסיף."]), m = []; if (ack.length) m.push({ text: ack[0] }); m.push({ text: it.followups[fi] }); return this.out(m); } }
    this.s.qaIntent = null;
    return this.st_topic("topic:" + (this.s.topic || "other"), "");
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
    if (!k || !F.topics[k]) k = this.guessTopic(t);
    if (!k || !F.topics[k]) {
      // "don't know" here counts toward auto-handoff exactly like in the questions stages (3 short "don't know"s).
      if (has(t, DONTKNOW) && words(raw) <= 3) { this.s.dk = (this.s.dk || 0) + 1; if (this.s.dk >= 3) { this.s.dk = 0; this.s.topicMiss = 0; return this.handoff(true); } }
      else if (raw.startsWith("topic:") || words(raw) === 0 || this.s.topicMiss) k = "other"; // free text: ask once with options, then go with "other"
      if (!k) { this.s.topicMiss = (this.s.topicMiss || 0) + 1;
        return this.out([{ text: this.s.topicMiss > 1 ? this.pick(F.ask_topic) : "לא בטוח שהבנתי לאיזה כיוון. תבחר/י אחד מהנושאים, או פשוט \"משהו אחר\" ונתחיל משם:" }], this.topicChips()); }
    }
    this.s.topicMiss = 0;
    this.s.topic = k; this.s.qi = 0; this.s.elab = 0; this.s.answers = {}; this.s.stage = "questions";
    this.s.usedCases = []; this.s.detourDone = false; this.s.inDetour = false; this.s.say = [];
    const n = F.topics[k].questions.length, rest = [];
    for (let i = 1; i < n; i++) rest.push(i);
    for (let i = rest.length - 1; i > 0; i--) { const j = this.rint(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.s.order = [0].concat(rest);
    if (this.mem) this.mem.save({ lastTopic: k });
    const m = [], q = this.pick(F.topics[k].questions[0].t);
    if (this.rnd() < 0.4) { const c = this.bestCase(); if (c) { this.s.usedCases.push(c.id); m.push({ text: this.pick(F.moves.opening_example) + "\n" + c.analogy, kind: "analogy", caseId: c.id }); this.moves.push("example"); this.lastMove = "example"; } }
    m.push({ text: q }); return this.out(m);
  };
  // Map free text to the closest topic via topic labels + case keywords; null if nothing matches.
  P.guessTopic = function (t) {
    const F = this.C.flows, score = {};
    for (const key of Object.keys(F.topics)) for (const w of F.topics[key].label.split(/[\s/]+/)) if (w.length > 2 && t.includes(norm(w))) score[key] = (score[key] || 0) + 2;
    for (const c of this.C.cases || []) for (const kw of c.keywords || []) if (t.includes(norm(kw))) for (const tp of c.topics) if (F.topics[tp]) score[tp] = (score[tp] || 0) + 1 / c.topics.length;
    const H = { career: ["עבודה","בוס","מנהל","משרה","ראיון","קריירה","קידום","משכורת","לימודים","תואר"], business: ["עסק","סטארטאפ","יזמות","לקוחות","שותף"],
      relationship: ["זוג","זוגיות","דייט","פרידה","להיפרד","חבר שלי","חברה שלי","ריב","רבתי"], family: ["אמא","אבא","הורים","אח","אחות","משפחה","ילד"] };
    for (const key in H) if (F.topics[key]) for (const w of H[key]) if (hasWord(t, norm(w))) score[key] = (score[key] || 0) + 1.5;
    let best = null, bs = 0; for (const k in score) if (score[k] > bs) { bs = score[k]; best = k; }
    return best;
  };
  P.canElab = function () { return this.freshOf(this.C.flows.elaborate).length > 0; };
  P.elab = function () { const F = this.C.flows; this.s.elab++; if (!this.s.firstElab) { this.s.firstElab = true; this.used[F.elaborate[0]] = { seen: [0], last: 0 }; return this.out([{ text: F.elaborate[0] }]); } return this.out([{ text: this.pick(F.elaborate) }]); };
  P.rememberPhrase = function (raw) { const w = String(raw).replace(/["<>]/g, "").split(/\s+/).filter(Boolean); if (w.length >= 3) (this.s.say = this.s.say || []).push(w.slice(0, Math.min(5, w.length)).join(" ")); };
  P.compose = function (q) {
    const F = this.C.flows, M = F.moves, say = this.s.say || [];
    const W = { short: 3, reflect: 2, example: 1.5, insight: 1.5, mirror: say.length ? 2 : 0, warm: 1.5, summary: say.length >= 2 ? 1 : 0,
      curveball: !this.s.detourDone && this.s.qi >= 2 ? 1.2 : 0 };
    if (W.example && !this.caseFor()) W.example = 0;
    for (const k of this.moves.slice(-3)) W[k] = 0;
    if (!Object.values(W).some(x => x > 0)) W.short = 1;
    let tot = 0; for (const k in W) tot += W[k]; let r = this.rnd() * tot, mv = "short";
    for (const k in W) { r -= W[k]; if (r < 0 && W[k] > 0) { mv = k; break; } }
    this.moves.push(mv); this.lastMove = mv;
    const n = this.myName(), nq = (n && this.rnd() < 0.3 ? n + ", " : "") + q, m = [];
    const occ = this.profile().occupation, hook = this.hookFor(occ);
    switch (mv) {
      case "short": m.push({ text: nq }); break;
      case "reflect": m.push({ text: this.fmt(this.pick(M.reflect)) + (hook && this.rnd() < 0.5 ? "\n" + hook : ""), kind: "insight" }, { text: q }); break;
      case "example": { const c = this.caseFor(); this.s.usedCases.push(c.id); m.push({ text: this.pick(F.analogy_intro) + "\n" + c.analogy, kind: "analogy", caseId: c.id }, { text: q }); break; }
      case "insight": m.push({ text: this.pick(M.insight), kind: "insight" }, { text: this.pick(M.then) + " " + q }); break;
      case "mirror": { const t = this.fmt(this.pick(M.mirror), { phrase: say[say.length - 1] }); if (this.rnd() < 0.5) m.push({ text: t + " " + nq }); else m.push({ text: t }, { text: q }); break; }
      case "warm": if (this.rnd() < 0.5) m.push({ text: this.pick(M.warm) + " " + nq }); else m.push({ text: this.pick(M.warm) }, { text: q }); break;
      case "summary": m.push({ text: this.fmt(this.pick(M.summary), { p1: say[say.length - 1], p2: say[0] }) }, { text: q }); break;
      case "curveball": this.s.detourDone = true; this.s.inDetour = true; this.s.pendingQ = q; m.push({ text: this.pick(F.curveballs[this.s.topic]) }); break;
    }
    return m;
  };
  P.sessionText = function () { return norm(Object.values(this.s.answers || {}).join(" ") + " " + (this.s.say || []).join(" ")); };
  P.knownParty = function () { const t = " " + this.sessionText() + " "; for (const k of this.C.flows.parties || []) if (t.includes(norm(k))) return k; return null; };
  P.hookFor = function (occ) { const F = this.C.flows, h = (F.occupation_hooks || {})[occ]; if (!h) return null;
    const bad = (F.occupation_conflicts || {})[occ] || [], t = this.sessionText() + " " + norm(this.lastRaw || "");
    return bad.some(b => t.includes(norm(b))) ? null : h; };
  P.bestCase = function () { const all = this.C.cases.filter(c => c.topics.includes(this.s.topic) && !(this.s.usedCases || []).includes(c.id)); return all.length ? all[this.rint(all.length)] : null; };
  P.caseFor = function () { const a = this.analogy(); return a || this.bestCase(); };
  P.st_questions = function (raw) {
    const F = this.C.flows, Q = F.topics[this.s.topic].questions;
    if (this.s.inDetour) { this.s.inDetour = false; this.rememberPhrase(raw);
      return this.out([{ text: this.pick(F.moves.curveball_return) }, { text: this.s.pendingQ }]); }
    if (words(raw) < 4 && this.s.elab < 2 && this.canElab()) return this.elab();
    const q = Q[this.s.order[this.s.qi]]; this.s.answers[q.id] = ((this.s.answers[q.id] || "") + " " + raw).trim(); // session-only, never persisted
    this.rememberPhrase(raw);
    this.s.qi++; this.s.elab = 0;
    const pre = [];
    if (this.s.qi < Q.length && Q[this.s.order[this.s.qi]].id === "who") {
      const party = this.knownParty();
      if (party) { this.s.answers.who = party; pre.push({ text: this.fmt(this.pick(F.who_known), { party }) }); this.moves.push("reference"); this.s.qi++; }
    }
    if (this.s.qi < Q.length) return this.out(pre.concat(this.compose(this.pick(Q[this.s.order[this.s.qi]].t))));
    this.s.stage = "reflection";
    if (pre.length) this.s.preReflect = pre;
    const a = this.analogy(), m = [{ text: this.pick(F.topics[this.s.topic].insight), kind: "insight" }];
    if (a) this.s.usedCases.push(a.id);
    if (this.s.preReflect) { m.unshift(...this.s.preReflect); this.s.preReflect = null; }
    if (a) m.push({ text: this.pick(F.analogy_intro) + " " + a.analogy, kind: "analogy", caseId: a.id });
    m.push({ text: this.pick(F.insight_followup) });
    return Object.assign(this.out(m, [{ label: "כן, מתאים", value: "כן זה מתאים לי, זה באמת מה שקורה" }, { label: "לא בדיוק", value: "לא בדיוק, אצלי זה קצת אחרת" }]), { analogyCase: a && a.id });
  };
  P.analogy = function () {
    const text = norm(Object.values(this.s.answers).join(" ")); let best = null, bs = -1;
    for (const c of this.C.cases) { if ((this.s.usedCases || []).includes(c.id)) continue; let s = c.topics.includes(this.s.topic) ? 2 : 0; for (const k of c.keywords) if (text.includes(norm(k))) s++; if (s > bs) { bs = s; best = c; } }
    return bs > 0 ? best : null;
  };
  P.st_reflection = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 4 && this.s.elab < 2 && this.canElab()) return this.elab();
    this.s.elab = 0; this.s.stage = "luck"; return this.out([{ text: this.pick(F.luck), kind: "insight" }]);
  };
  P.st_luck = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 3 && this.s.elab < 2 && this.canElab()) return this.elab();
    this.s.elab = 0; this.action = raw; this.s.stage = "closing";
    const style = this.hidden.style || (this.profile().preferredStyle) || "validation";
    return this.out([{ text: this.pick(style === "direction" ? F.ask_conclusion_direction : F.ask_conclusion_validation) }]);
  };
  P.st_closing = function (raw) {
    const F = this.C.flows;
    if (words(raw) < 3 && this.s.elab < 2 && this.canElab()) return this.elab();
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
