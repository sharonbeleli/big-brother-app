// Q&A knowledge-base matcher. Pure, no network, no storage. match(kb, text) -> {intent, score, second} | null
// Hebrew normalisation: niqqud/punctuation strip, final letters, letter-stretch collapse ("למהההה"), prefix stripping (ו/ה/ב/ל/ש/כ/מ), slang synonyms.
(function (root) {
  const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  const STOP = new Set("אני את אתה אנחנו הוא היא הם זה זאת זו של שלי שלך לי לך לו לה יש אין גם רק עם על אל כל כי אם או אבל עוד כבר עכשיו פשוט ממש כאילו סתם וואלה יאללה תכלס בקיצור באמת קצת מאוד מלא די איך מה למה מתי כמה איפה שאני שזה כזה כזאת היה הייתי להיות אחי אחותי גבר מאמי בן ונה תגיד תגידי אוקיי טוב נו יעני wtf lol לא כן אם עליי אליי מול לעשות עושה רוצה רוצים בא מרגיש מרגישה יודע יודעת תמיד הזמן זמן לפני אחרי שבוע יום היום מחר אתמול אותי אותו אותה ממני ממנו ממנה בכלל לגמרי הכי עדיין שוב".split(" ").map(w => w.replace(/[ךםןףץ]/g, c => FINALS[c])));
  const PREF = ["וה", "שה", "וש", "וב", "ול", "מה", "כש", "שב", "של", "ו", "ה", "ב", "ל", "ש", "כ", "מ"];
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "").replace(/[ךםןףץ]/g, c => FINALS[c])
      .replace(/(.)\1{2,}/g, "$1").replace(/[^\u05d0-\u05eaa-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  // canonical form of one token via synonym table (built once per kb)
  function synIndex(kb) {
    if (kb._syn) return kb._syn; const m = new Map();
    for (const canon in kb.synonyms || {}) for (const v of [canon].concat(kb.synonyms[canon])) {
      const n = norm(v); if (n.includes(" ")) continue; m.set(n, norm(canon)); }
    const phrases = [];
    for (const canon in kb.synonyms || {}) for (const v of kb.synonyms[canon]) { const n = norm(v); if (n.includes(" ")) phrases.push([n, norm(canon)]); }
    phrases.sort((a, b) => b[0].length - a[0].length);
    return (kb._syn = { m, phrases });
  }
  function variants(tok) {
    const out = [tok];
    for (const p of PREF) if (tok.startsWith(p) && tok.length - p.length >= 3) out.push(tok.slice(p.length));
    for (const s of ["ים", "ות", "יות"]) if (tok.endsWith(s) && tok.length - s.length >= 3) out.push(tok.slice(0, -s.length));
    return out;
  }
  function tokens(kb, s) {
    const S = synIndex(kb); let t = " " + norm(s) + " ";
    for (const [p, c] of S.phrases) t = t.split(" " + p + " ").join(" " + c + " ");
    const set = new Set();
    for (const w of t.trim().split(" ")) {
      if (!w || w.length < 2 || STOP.has(w)) continue; let canon = w;
      for (const v of variants(w)) { if (S.m.has(v)) { canon = S.m.get(v); break; } }
      if (canon && !STOP.has(canon)) set.add(canon);
    }
    return set;
  }
  // token similarity: exact/variant = 1, shared stem (prefix ≥4 chars) = .7
  function sim(a, b) {
    if (a === b) return 1; const va = variants(a), vb = variants(b);
    if (va.some(x => vb.includes(x))) return 0.9;
    const n = Math.min(a.length, b.length); if (n >= 4 && (a.startsWith(b.slice(0, 4)) && b.startsWith(a.slice(0, 4))) && Math.abs(a.length - b.length) <= 2) return 0.7;
    return 0;
  }
  function overlap(q, e) { let s = 0; for (const x of e) { let best = 0; for (const y of q) { const v = sim(x, y); if (v > best) best = v; if (best === 1) break; } s += best; } return s; }
  function prepare(kb) {
    if (kb._prep) return kb._prep;
    return (kb._prep = (kb.intents || []).map(it => ({ it, ex: it.examples.map(e => tokens(kb, e)).filter(x => x.size), kw: new Set((it.keywords || []).map(k => [...tokens(kb, k)][0]).filter(Boolean)) })));
  }
  function scoreAll(kb, text) {
    const q = tokens(kb, text); if (!q.size) return [];
    return prepare(kb).map(({ it, ex, kw }) => {
      let best = 0;
      for (const e of ex) { const o = overlap(q, e); const d = (2 * o) / (q.size + e.size); if (d > best) best = d; }
      let k = 0; for (const x of kw) if ([...q].some(y => sim(x, y) >= 0.9)) k++;
      if (q.size < 2 && !k) best = Math.min(best, 0.3);            // one-word messages need a strong keyword hit
      return { intent: it, score: Math.min(1, best + Math.min(0.3, 0.15 * k)) };
    }).sort((a, b) => b.score - a.score);
  }
  // Confident match only: score ≥ threshold AND clear margin over runner-up (unless very high).
  function match(kb, text, opts) {
    opts = opts || {}; const th = opts.threshold != null ? opts.threshold : (kb.threshold || 0.45), margin = kb.margin || 0.08;
    const r = scoreAll(kb, text); if (!r.length) return null;
    const [a, b] = r, second = b ? b.score : 0;
    if (a.score < th) return null;
    if (a.score - second < margin && a.score < 0.75) return null;
    return { intent: a.intent, score: +a.score.toFixed(3), second: +second.toFixed(3) };
  }
  const api = { norm, tokens, match, scoreAll };
  if (typeof module !== "undefined") module.exports = api; else root.BBQA = api;
})(this);
