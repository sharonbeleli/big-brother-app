(function (root) {
  const KW = {
    3: ["הולך להתאבד","הולכת להתאבד","קניתי כדורים","הלילה זה נגמר","כתבתי מכתב פרידה","going to kill myself","tonight i end it"],
    2: ["להתאבד","מתאבד","בא לי למות","רוצה למות","לפגוע בעצמי","חותך את עצמי","חותכת את עצמי","עדיף שלא אהיה","kill myself","suicide","suicidal","want to die","self harm","self-harm","cut myself"],
    1: ["אין טעם לחיות","אף אחד לא יתגעגע","יותר טוב בלעדיי","נמאס לי מהחיים","no reason to live","better off without me"]
  };
  const HARM_OTHERS = ["אהרוג אותו","אהרוג אותה","אני אהרוג","לפגוע בו","לפגוע בה","לרצוח","kill him","kill her","hurt him","hurt her","shoot them"];
  const HANDOFF = {response_time_hours:24, max_handoffs_per_user:2, window_days:30, non_convergence_repeats:2};
  const HOTLINES = {
    IL: [{name:'ער"ן – עזרה ראשונה נפשית (24/7)',phone:"1201"},{name:'ער"ן בוואטסאפ',url:"https://wa.me/972528451201"},{name:'סה"ר – צ\'אט 24/7',url:"https://sahar.org.il"},{name:'מד"א – סכנה מיידית',phone:"101"},{name:"משטרה",phone:"100"}],
    US: [{name:"988 Suicide & Crisis Lifeline",phone:"988"},{name:"Emergency",phone:"911"}],
    GB: [{name:"Samaritans",phone:"116123"},{name:"Emergency",phone:"999"}],
    INTL: [{name:"Find A Helpline",url:"https://findahelpline.com"}]
  };
  function norm(t){return String(t||"").toLowerCase().replace(/[\u0591-\u05C7]/g,"").replace(/\s+/g," ");}
  function detectCrisis(text){
    const t = norm(text);
    for (const k of HARM_OTHERS) if (t.includes(k)) return {level:3, trigger:k, type:"others"};
    for (const lvl of [3,2,1]) for (const k of KW[lvl]) if (t.includes(k)) return {level:lvl, trigger:k};
    return {level:0, trigger:null};
  }
  function getHotlines(cc){ return HOTLINES[(cc||"IL").toUpperCase()] || HOTLINES.INTL; }
  const QUESTIONS = ["מה קורה? ספר במשפט אחד.","מה כבר החלטת לעשות?","למה דווקא עכשיו? מה השתנה?","אילו עוד גורמים מעורבים במצב?","מה כבר ניסית?","איך ייראה מצב טוב בעוד שנה-שנתיים?","מי משלם בפועל, ומה היכולת שלו לשלם עכשיו?"];
  const ELABORATE="כן, תפרט לי עוד";
  const DISCLAIMER="תזכורת: אתה מדבר עם בוט, הוא יכול לטעות. התשובה הנכונה נמצאת אצלך – אני כאן לעזור לך למצוא אותה.";
  function crisisMessage(level,type){
    if (type==="others") return "אני חייב לעצור כאן. כשיש סכנה שמישהו ייפגע – פונים מיד לעזרה: משטרה 100 או מד\"א 101. אם אתה מרגיש שאתה מאבד שליטה, ער\"ן 1201 זמינים עכשיו לדבר.";
    return (level>=3?"אני מודאג לשלומך עכשיו. אם אתה בסכנה מיידית – תתקשר עכשיו למד\"א 101 או למשטרה 100.\n":"") +
      "אני שומע שקשה לך מאוד, ואני רוצה שתהיה בטוח. אני בוט ולא יכול לעזור בזה כמו בן אדם – אבל יש אנשים שזמינים בשבילך עכשיו. יש מישהו קרוב שאתה יכול להתקשר אליו עכשיו?";
  }
  // Demo (rule-based) flow: asks opening questions, then a methodology-shaped summary.
  function demoReply(state, userText){
    state.answers = state.answers || [];
    const words = String(userText).trim().split(/\s+/).filter(Boolean).length;
    if (words < 4 && !state.elaborated) { state.elaborated = true; return ELABORATE; }
    state.elaborated = false;
    state.answers.push(userText);
    const i = state.answers.length;
    if (i < QUESTIONS.length) return QUESTIONS[i];
    return "תודה. אולי – רק אולי? – לפני שאני מאשר את מה שהחלטת – שים לב: מה שהשתנה (\"" + state.answers[2] + "\") אולי הוא הבעיה האמיתית, לא ההחלטה עצמה.\n" +
      "צעד קונקרטי לשבוע הקרוב: שיחה אחת עם " + (state.answers[3]||"האדם המעורב") + " – לשאול מה הוא צריך, לפני שאתה דורש משהו.\n" +
      "רוצה 5 דקות עם אח גדול אמיתי החודש? (מצב הדגמה – תשובה מבוססת כללים, לא AI)";
  }
  // Non-crisis handoff with per-user cap (Sharon clarification 8)
  function requestHandoff(user, now, cfg){
    cfg = cfg || HANDOFF; now = now || Date.now();
    const win = cfg.window_days*864e5;
    user.handoffs = (user.handoffs||[]).filter(ts => now-ts < win);
    if (user.handoffs.length >= cfg.max_handoffs_per_user)
      return {ok:false, message:"הגעת למכסת ההעברות לגורם אנושי לתקופה הזו. נמשיך כאן ביחד, ואפשר לנסות שוב בהמשך."};
    user.handoffs.push(now);
    return {ok:true, message:"השיחה הועברה לגורם אנושי לבחינה. תשובה תתקבל תוך "+cfg.response_time_hours+" שעות."};
  }
  function isNonConverging(history, cfg){
    cfg = cfg || HANDOFF; const seen={};
    for (const h of history){ const k=norm(h).trim(); seen[k]=(seen[k]||0)+1; if (seen[k]>cfg.non_convergence_repeats) return true; }
    return false;
  }
  const api = {requestHandoff,isNonConverging,HANDOFF,ELABORATE,DISCLAIMER,HARM_OTHERS,detectCrisis,getHotlines,QUESTIONS,crisisMessage,demoReply,KW};
  if (typeof module !== "undefined") module.exports = api; else root.BB = api;
})(this);
