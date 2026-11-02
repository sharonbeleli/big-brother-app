// Auth + onboarding + trial gate (Supabase). Runs AFTER safety/engine are loaded; never touches the crisis layer.
(function(){
if(window.BB_TEST||!/^https?:$/.test(location.protocol))return; // offline/test builds: no gate
function boot(){
const Q=[
 {k:'name',q:'איך לקרוא לך? (שם או כינוי)',type:'text'},
 {k:'ageRange',q:'בן/בת כמה את/ה?',opts:['מתחת ל-18','18–21','22–26','27–35','35+']},
 {k:'gender',q:'מגדר (לא חובה)',opts:['גבר','אישה','אחר','מעדיף/ה לא לומר']},
 {k:'occupation',q:'מה את/ה עושה בימים אלה?',opts:['תלמיד/ה','חייל/ת','סטודנט/ית','עובד/ת','מחפש/ת עבודה','אחר']},
 {k:'living',q:'איפה את/ה גר/ה?',opts:['עם ההורים','עם שותפים','לבד','עם בן/בת זוג','בבסיס / מעונות','אחר']},
 {k:'tone',q:'איזה סגנון מתאים לך?',opts:['ישיר ותכל׳ס','תומך ורגוע','מצחיק וקליל','מעורב']},
 {k:'length',q:'אורך תשובות מועדף?',opts:['קצר ולעניין','בינוני','מפורט']},
 {k:'interests',q:'אילו תחומים הכי מעניינים אותך? (אפשר כמה)',multi:true,opts:['קריירה','לימודים','כסף','זוגיות','משפחה','חברים','צבא','עסק','בריאות ורגש']},
 {k:'source',q:'איך הגעת אלינו?',opts:['חבר/ה','אינסטגרם','טיקטוק','גוגל','אחר']},
 {k:'hope',q:'מה יגרום לזה להיות שימושי בשבילך?',opts:['כיוון ברור','מישהו שמקשיב','כלים מעשיים','דעה כנה','לא בטוח/ה עדיין']}
];
const css=`#gate{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;display:flex;flex-direction:column;align-items:center;padding:calc(24px + env(safe-area-inset-top)) 16px 24px}
#gate .card{width:100%;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
#gate h1{margin:0 0 4px;font-size:24px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;color:transparent}
#gate p{color:var(--muted);margin:6px 0 14px;font-size:14px;line-height:1.5}
#gate input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:16px;margin:6px 0}
#gate button.p{width:100%;padding:13px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:16px;font-weight:700;margin-top:8px}
#gate button.s{width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font-size:15px;margin-top:8px}
#gate .lnk{background:none;border:0;color:var(--accent);font-size:14px;margin-top:10px;width:100%}
#gate .opts{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}#gate .opts button{background:var(--chip);color:var(--chipText);border:2px solid transparent;border-radius:999px;padding:10px 14px;font-size:15px;font-weight:600}
#gate .opts button.on{border-color:var(--accent)}#gate .err{color:#e11d48;font-size:14px;min-height:18px}
#gate .priv{font-size:12px;color:var(--muted);line-height:1.5;margin-top:10px}#gate .hot{font-size:12px;color:var(--muted);margin-top:16px;text-align:center}
#trialBadge{font-size:11px;background:rgba(255,255,255,.2);border-radius:999px;padding:3px 8px;margin-inline-start:4px}`;
const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
const gate=document.createElement('div');gate.id='gate';document.body.appendChild(gate);
const HOT='<div class="hot">במצוקה? ער"ן <a href="tel:1201">1201</a> · מד"א <a href="tel:101">101</a> · משטרה <a href="tel:100">100</a></div>';
const PRIV='<div class="priv">🔒 הודעת פרטיות (טיוטה): אנחנו שומרים רק פרטים כלליים (כמו שם וגיל) כדי להתאים את השיחה. תוכן הדילמות לא נשמר בשרת — חוץ מסיכום קצר וכללי אם ביקשת לדבר עם בן אדם. אפשר לבקש מחיקה בכל עת. <i>[טיוטה – ממתין לבדיקת עו״ד]</i></div>';
const el=(h)=>{gate.innerHTML='<div class="card">'+h+'</div>'+HOT;gate.style.display='flex';return gate;};
const $=s=>gate.querySelector(s);let sb,user,prof;
async function api(path,opts){const s=(await sb.auth.getSession()).data.session;return fetch(path,Object.assign({headers:{Authorization:'Bearer '+(s&&s.access_token),'Content-Type':'application/json'}},opts||{})).then(r=>r.json());}
function login(mode){
 el(`<h1>ביג ברדר</h1><p>${mode==='up'?'פותחים חשבון – 7 ימי ניסיון חינם.':'ברוך שובך! מתחברים.'}</p>
 <input id="em" type="email" autocomplete="email" placeholder="אימייל" dir="ltr"><input id="pw" type="password" autocomplete="${mode==='up'?'new-password':'current-password'}" placeholder="סיסמה (8+ תווים)" dir="ltr">
 <div class="err" id="er"></div><button class="p" id="go">${mode==='up'?'הרשמה':'כניסה'}</button>
 <button class="s" id="gg">המשך עם Google</button><button class="lnk" id="sw">${mode==='up'?'כבר יש לי חשבון – כניסה':'אין חשבון? להרשמה'}</button>${mode==='up'?PRIV:''}`);
 $('#sw').onclick=()=>login(mode==='up'?'in':'up');
 $('#gg').onclick=async()=>{const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});if(error)$('#er').textContent='התחברות עם Google עוד לא זמינה';};
 $('#go').onclick=async()=>{const email=$('#em').value.trim(),password=$('#pw').value;$('#er').textContent='';
  const r=mode==='up'?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});
  if(r.error){$('#er').textContent=mode==='up'?'ההרשמה נכשלה: '+r.error.message:'אימייל או סיסמה שגויים';return;}
  if(!r.data.session){$('#er').textContent='שלחנו לך מייל לאישור. אשר/י ואז התחבר/י.';return;} after();};
}
function onboarding(){const ans={};let i=0;
 const show=()=>{if(i>=Q.length)return finish();const q=Q[i];let sel=q.multi?[]:null;
  el(`<p>שאלה ${i+1} מתוך ${Q.length} · רק פרטים כלליים</p><h1 style="font-size:20px">${q.q}</h1>${q.type==='text'?'<input id="tx" maxlength="24">':'<div class="opts" id="op"></div>'}
  <button class="p" id="nx">הבא</button><button class="lnk" id="sk">דלג</button>`);
  if(q.opts)q.opts.forEach(o=>{const b=document.createElement('button');b.textContent=o;b.onclick=()=>{if(q.multi){b.classList.toggle('on');sel=[...$('#op').children].filter(x=>x.classList.contains('on')).map(x=>x.textContent);}else{sel=o;[...$('#op').children].forEach(x=>x.classList.toggle('on',x===b));}};$('#op').appendChild(b);});
  $('#nx').onclick=()=>{const v=q.type==='text'?$('#tx').value.trim():sel;if(v&&(!Array.isArray(v)||v.length))ans[q.k]=v;i++;show();};
  $('#sk').onclick=()=>{i++;show();};};
 const finish=async()=>{await sb.from('profiles').update({onboarding:ans,onboarding_done:true}).eq('id',user.id);prof.onboarding=ans;prof.onboarding_done=true;feed(ans,true);after();};
 show();}
// Feed general details into the existing local memory/personalisation.
function feed(a,restart){try{const m=BBMemory.createMemory(window.localStorage);const p={};
 if(a.name)p.name=a.name;if(a.ageRange)p.ageRange=a.ageRange;if(a.occupation)p.occupation=a.occupation;
 if(a.tone==='ישיר ותכל׳ס')p.preferredStyle='direction';if(a.tone==='תומך ורגוע')p.preferredStyle='validation';
 const cur=m.load()||{};if(Object.keys(p).some(k=>cur[k]!==p[k])||restart){m.save(p);if(window.bbRestart)window.bbRestart();}}catch(e){}}
function daysLeft(){return Math.ceil((new Date(prof.trial_started_at).getTime()+prof.trial_days*864e5-Date.now())/864e5);}
function paywall(){el(`<h1>תקופת הניסיון הסתיימה</h1><p>תודה שניסית את ביג ברדר! 💜</p><h1 style="font-size:20px">תשלום יגיע בקרוב</h1><p>אנחנו עובדים על אפשרות מנוי. בינתיים אפשר לפנות אלינו להארכה.</p><button class="s" id="lo">התנתקות</button>`);$('#lo').onclick=logout;}
async function logout(){await sb.auth.signOut();location.reload();}
async function after(){
 user=(await sb.auth.getUser()).data.user;if(!user)return login('up');
 const b=await api('/api/bootstrap',{method:'POST'});prof=b.profile;if(!prof){el('<p>שגיאה בטעינת הפרופיל, נסה/י לרענן.</p>');return;}
 if(!prof.onboarding_done)return onboarding();
 feed(prof.onboarding||{},false);
 const d=daysLeft();if(d<=0&&!prof.is_admin)return paywall();
 gate.style.display='none';const t=document.querySelector('.title small');let bd=document.getElementById('trialBadge');
 if(!bd){bd=document.createElement('span');bd.id='trialBadge';t.appendChild(bd);}bd.textContent=prof.is_admin?'מנהל':'נשארו '+d+' ימי ניסיון';
 const menu=document.getElementById('menu');if(!document.getElementById('logoutBtn')){const lo=document.createElement('button');lo.id='logoutBtn';lo.textContent='🚪 התנתקות';lo.onclick=logout;menu.appendChild(lo);
  if(prof.is_admin){const ad=document.createElement('button');ad.textContent='🛠️ ניהול';ad.onclick=()=>location.href='/admin';menu.appendChild(ad);}}
}
// Handoff: store a SHORT neutral summary server-side (admin-only). No free text from the conversation.
const TOPIC={career:'קריירה',business:'עסק',relationship:'זוגיות',family:'משפחה',other:'אחר'};
window.BBAuth={onHandoff:async function(eng,res){try{if(!sb||!user)return;const o=(prof&&prof.onboarding)||{};
 const summary={profile:{name:o.name||null,ageRange:o.ageRange||null,occupation:o.occupation||null,tone:o.tone||null},
  theme:TOPIC[eng.s.topic]||null,subtheme:eng.s.sub||null,stage:eng.s.stage,auto:!!(res&&res.auto),turns:eng.turns.length,
  note:'המשתמש/ת ביקש/ה לדבר עם בן אדם'+(eng.s.topic?' בנושא '+(TOPIC[eng.s.topic]||''):'')};
 await sb.from('handoffs').insert({user_id:user.id,summary});}catch(e){}}};
(async()=>{el('<p>טוען...</p>');try{const c=await fetch('/api/config').then(r=>r.json());
 sb=window.supabase.createClient(c.url,c.anonKey);window.bbSupabase=sb;
 const s=(await sb.auth.getSession()).data.session;if(s)after();else login('up');}catch(e){el('<p>אין חיבור לשרת כרגע.</p>');}})();
}
const sc=document.createElement('script');sc.src='/supabase.js';sc.onload=boot;sc.onerror=()=>{};document.head.appendChild(sc);
})();
