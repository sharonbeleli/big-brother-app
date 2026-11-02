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
  // --- Normalization: niqqud/punct strip, final letters, ט→ת typo, 3+ repeated letters collapsed. Applied to text AND keywords.
  const FINALS={"ך":"כ","ם":"מ","ן":"נ","ף":"פ","ץ":"צ"};
  function crisisNorm(t){return " "+String(t||"").toLowerCase().replace(/[\u0591-\u05C7]/g,"").replace(/[ךםןףץ]/g,c=>FINALS[c]).replace(/ט/g,"ת")
    .replace(/[^\p{L}\p{N}]+/gu," ").replace(/(\p{L})\1{2,}/gu,"$1").replace(/\s+/g," ").trim()+" ";}
  // Narrow idiom allowlist (removed before matching; any other trigger in the text still fires).
  const IDIOMS=[/(למות|מת|מתה|מתימ|אמות) (מ?צחוק|מרוב צחוק|מצחוקימ)/g,/(למות|מת|מתה|אמות) על (זה|זו|זאת) /g];
  const P=" [^ ]+"; // one extra word
  const SELF_RX={
    3:[/(^| )[ושכהלמב]*(ל?התאב[דת]|מתאב[דת]|אתאב[דת]|נתאב[דת]|תתאב[דת]|יתאב[דת])( |ת )?(ה?לילה|היומ|עכשיו|מחר)/,
       /(לקחתי|בלעתי|קניתי|אספתי|אגרתי|שתיתי)(?: [^ ]+){0,3} ה?(כדורימ|כדורי שינה|תרופות)/,
       /(לקפוצ|אקפוצ|קופצ|קופצת|ליפול|לזרוק את עצמי)(?: [^ ]+){0,3} (מ|מה|מעל ה)?(גג|גשר|חלונ|מרפסת|קומה|צוק)/,
       /(i took|took|swallowed|overdosed? on)(?: \w+){0,2} (pills|meds)/,/\b(going to|gonna|will) (kill myself|end it|end my life|unalive)/],
    2:[/(^| )[ושכהלמב]*(ל?התאב[דת]|מתאב[דת]|אתאב[דת]|נתאב[דת]|תתאב[דת]|יתאב[דת]|התאבדות|אובדנ)/,
       /(רוצה|רוצימ|בא ?לי|מתחשק ?לי|חושק|הלוו?אי|מעדיפ|מעדיפה|צריכ|צריכה)(?: [^ ]+){0,3} (למות|אמות|להיעלמ לתמיד|לגמור עמ זה|לגמור את החיימ|לסיימ את החיימ|לסיימ עמ החיימ|לא להתעורר)/,
       /(לישונ|ללכת לישונ|להירדמ) ו?לא להתעורר/,/לא להתעורר (יותר|לעולמ|אף פעמ|מחר)/,
       /(לא|אינני) (רוצה|רוצימ|מסוגל|מסוגלת|יכול|יכולה)(?: [^ ]+){0,2} (לחיות|להמשיכ לחיות|לחיות יותר|להמשיכ ככה|להיות פה|להיות בחיימ|להתקיימ)/,
       /(נמאס|נשבר|נגמר|אינ לי כוח|אינ לי כח)( לי)?(?: [^ ]+){0,1} (לחיות|מהחיימ|מלחיות|מהכל לגמרי)/,
       /(בשביל מה|למה|סיבה|טעמ|מה הטעמ) (לי )?(לחיות|להמשיכ לחיות)/,
       /הלוו?אי ו?ש?(הייתי|היתי|אני|ואני)( [^ ]+)? (מת|מתה|נעלמ|נעלמת|לא קיימ|לא קיימת|לא נולד|לא נולדתי|לא נולדה)/,
       /הלוו?אי ו?(שאמות|אמות|שאני ימות|שאמות כבר)/,
       /(לחתוכ|אחתוכ|חותכ|חותכת|חתכתי|לפגוע|פוגע|פוגעת|פגעתי|אפגע|להרביצ|מרביצ|מרביצה|לשרופ|שורפ|שורפת|שרפתי|לחנוק|להרעיב)(?: את)? ?ב?(עצמי|עצמ שלי) /,
       /(^| )(לחתוכ|לחתוכ לעצמי|חתכתי|חותכ|חותכת) (ורידימ|את הורידימ|ה?יד|ה?ידיימ|ה?רגל)/,
       /\b(kms|kys myself|unalive|unaliving|suicid\w*|self ?harm\w*|wanna die|want to die|wanna be dead|want to be dead|end my life|end it all|kill my ?self|cut my ?self|hurt my ?self|sewer ?slide|not wanna live|dont want to live|don t want to live)\b/,
       /(רוצה|בא ?לי|מתחשק ?לי) (למות|לימות|לאמות)/],
    1:[/אינ לי (בשביל מה|סיבה|למה) לקומ/,/(אפ אחד|אף אחד) לא (יתגעגע|ישימ לב|יבכה)/,/(יותר טוב|עדיפ) (בלעדי|לכולמ בלעדי|שלא אהיה|שאני לא אהיה)/,/(i dont|i don t) want to (be here|exist)/,/\bno reason to live\b/]
  };
  const OTH_V="(ארצח|לרצוח|רוצח|רוצחת|אהרוג|להרוג|הורג|הורגת|אפגע|לפגוע|פוגע|פוגעת|לדקור|אדקור|דוקר|דוקרת|לירות|אירה|לחנוק|אחנוק|לשרופ|אשרופ)";
  const OTH_O="(אותו|אותה|אותמ|אותכ|אותכמ|אותנ|בו|בה|בהמ|בכ|את (ה?[^ ]+))";
  const OTHERS_RX={
    3:[new RegExp(OTH_V+"(?: [^ ]+)? "+OTH_O+"( |$)"),new RegExp("(^| )[ושכ]*(ארצח|אהרוג|לרצוח|להרוג)( |$)"),
       /(סכינ|אקדח|נשק|רובה|סכינימ)(?: [^ ]+){0,5} (הולכ|הולכת|בא|באה|נוסע|נוסעת|רצ|מחכה|אגיע) (אליו|אליה|אליהמ|אליכ|לבית שלו|לבית שלה|לבית ספר)/,
       /\b(kill|murder|stab|shoot) (him|her|them|you|my \w+)\b/,/\bi(?: m| am| will|ll)? (gonna |going to )?(kill|murder|stab|shoot)\b/],
    2:[/(להרביצ|ארביצ|מרביצ|מרביצה|לפרק|אפרק|לשבור|אשבור)( [^ ]+)? (לו|לה|להמ|לכ|אותו|אותה|את הפרצופ|לו את הצורה|לה את הצורה|את העצמות)/,/\b(beat|hurt) (him|her|them) up\b|\bhurt (him|her|them)\b/]
  };
  function detectCrisis(text){
    let t = crisisNorm(text);
    for (const rx of IDIOMS) t = t.replace(rx," ");
    const has=k=>t.includes(crisisNorm(k).trim());
    for (const k of HARM_OTHERS) if (has(k)) return {level:3, trigger:k, type:"others"};
    for (const rx of OTHERS_RX[3]) if (rx.test(t)) return {level:3, trigger:String(rx), type:"others"};
    for (const lvl of [3,2,1]) {
      for (const k of KW[lvl]) if (has(k)) return {level:lvl, trigger:k};
      for (const rx of SELF_RX[lvl]) if (rx.test(t)) return {level:lvl, trigger:String(rx)};
      if (lvl===2) for (const rx of OTHERS_RX[2]) if (rx.test(t)) return {level:2, trigger:String(rx), type:"others"};
    }
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
  const api = {crisisNorm,SELF_RX,OTHERS_RX,IDIOMS,requestHandoff,isNonConverging,HANDOFF,ELABORATE,DISCLAIMER,HARM_OTHERS,detectCrisis,getHotlines,QUESTIONS,crisisMessage,demoReply,KW};
  if (typeof module !== "undefined") module.exports = api; else root.BB = api;
})(this);
