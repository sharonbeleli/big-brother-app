// Per-user memory: ONLY general details. Never dilemma content / free text answers.
(function (root) {
  const KEY = "bb_profile_v1";
  const ENUMS = {
    ageRange: ["מתחת ל-18","18–21","22–26","27–35","35+"],
    occupation: ["תלמיד/ה","חייל/ת","סטודנט/ית","עובד/ת","מחפש/ת עבודה","אחר"],
    preferredStyle: ["direction","validation"],
    lastTopic: ["career","business","relationship","family","other"]
  };
  const ALLOWED = ["name","ageRange","occupation","city","preferredStyle","sessions","lastVisit","lastTopic","handoffs"];
  function clean(k, v) {
    if (ENUMS[k]) return ENUMS[k].includes(v) ? v : undefined;
    if (k === "name" || k === "city") { v = String(v || "").replace(/[<>]/g, "").trim().slice(0, 24); return v || undefined; }
    if (k === "sessions") return Number.isInteger(v) && v >= 0 ? v : undefined;
    if (k === "handoffs") return Array.isArray(v) ? v.filter(x => typeof x === "number").slice(-20) : undefined;
    if (k === "lastVisit") return typeof v === "number" ? v : undefined;
  }
  function createMemory(storage) {
    let mem = {};
    const st = {
      get() { try { if (storage) return storage.getItem(KEY); } catch (e) {} return mem[KEY] || null; },
      set(v) { mem[KEY] = v; try { if (storage) storage.setItem(KEY, v); } catch (e) {} },
      del() { delete mem[KEY]; try { if (storage) storage.removeItem(KEY); } catch (e) {} }
    };
    return {
      load() { try { const o = JSON.parse(st.get() || "null"); if (!o) return null; const r = {}; for (const k of ALLOWED) { const c = clean(k, o[k]); if (c !== undefined) r[k] = c; } return r; } catch (e) { return null; } },
      save(patch) { const cur = this.load() || {}; for (const k of Object.keys(patch || {})) { if (!ALLOWED.includes(k)) continue; const c = clean(k, patch[k]); if (c !== undefined) cur[k] = c; } st.set(JSON.stringify(cur)); return cur; },
      forget() { st.del(); },
      raw() { return st.get(); }
    };
  }
  const api = { createMemory, ALLOWED, ENUMS, KEY };
  if (typeof module !== "undefined") module.exports = api; else root.BBMemory = api;
})(this);
