/* سبيدي — منصة تتبع المندوبين (مشروع Firebase مستقل: speedy-driver) */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, deleteField, query, where, documentId, writeBatch, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getDatabase, ref as dbRef, onValue, get as dbGet, update as dbUpdate, remove as dbRemove, set as dbSet, query as dbQuery, orderByKey, endAt } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import * as CONF from './firebase-config.js';
const firebaseConfig=CONF.firebaseConfig;
const OWNER=String(CONF.ownerEmail||'').trim().toLowerCase();

/* ========== helpers ========== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD=ds=>{const[y,m,d]=ds.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(ds,n)=>{const d=parseD(ds);d.setDate(d.getDate()+n);return ymd(d)};
const todayStr=()=>ymd(new Date());
const monthOf=ds=>ds.slice(0,7);
const prevMonth=m=>{let[y,mo]=m.split('-').map(Number);mo--;if(!mo){mo=12;y--}return `${y}-${pad(mo)}`};
const hm=ms=>{if(!ms)return '—';const d=new Date(ms);return `${pad(d.getHours())}:${pad(d.getMinutes())}`};
const toMin=t=>{const[h,m]=String(t||'0:0').split(':').map(Number);return h*60+(m||0)};
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const dur=min=>{min=Math.max(0,Math.round(min));const h=Math.floor(min/60),m=min%60;return h?(m?`${h} س ${m} د`:`${h} س`):`${m} د`};
const DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const dayLabel=ds=>{const d=parseD(ds);return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`};
const monthLabel=m=>{const[y,mo]=m.split('-').map(Number);return `${MONTHS[mo-1]} ${y}`};
const initials=n=>esc(String(n||'?').trim().charAt(0));
const SH={m:'الصباحية',e:'المسائية'};
const ST={present:['حاضر','c-g'],absent:['غائب','c-r'],leave:['إجازة / عذر','c-b']};
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('on'),2800)}
/* end time label: 00:00/24:00 = midnight; earlier than start = after midnight */
const endLabel=(c)=>{if(c.end==='24:00'||c.end==='00:00')return '12:00 ليلاً';return toMin(c.end)<=toMin(c.start)?`${c.end} (بعد منتصف الليل)`:c.end};

/* ========== config check ========== */
const gate=$('#gate');
const gateHTML=inner=>`<div class="gbox"><img src="icons/icon-192.png" width="72" height="72" alt="سبيدي"><h2>سبيدي</h2><div class="mu">منصة تتبع المندوبين</div>${inner}</div>`;
if(!firebaseConfig||!firebaseConfig.apiKey||String(firebaseConfig.apiKey).startsWith('PASTE')){
  gate.innerHTML=gateHTML(`<div class="card" style="margin-top:18px;text-align:right;line-height:1.9">⚙️ <b>البرنامج غير مربوط بـ Firebase بعد.</b><br>افتح الملف <code>js/firebase-config.js</code> وضع فيه بيانات مشروعك (firebaseConfig) ثم ارفعه من جديد على GitHub.</div>`);
  throw new Error('firebase-config.js not filled');
}

/* ========== firebase ========== */
const fbApp=initializeApp(firebaseConfig);
const auth=getAuth(fbApp);
let db;
try{db=initializeFirestore(fbApp,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()}),ignoreUndefinedProperties:true})}
catch(e){console.warn('offline cache unavailable',e);db=initializeFirestore(fbApp,{ignoreUndefinedProperties:true})}
let rtdb=null;try{if(firebaseConfig.databaseURL)rtdb=getDatabase(fbApp,firebaseConfig.databaseURL)}catch(e){console.warn('RTDB unavailable',e)}
const DRIVER_DOMAIN=String(CONF.driverDomain||'drivers.speedy.com.ly');
const ekey=e=>String(e||'').toLowerCase().replace(/\./g,',');
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

/* ========== data ========== */
const DEFAULTS={shifts:{m:{start:'10:00',end:'17:00'},e:{start:'17:00',end:'24:00'}},grace:10,minShifts:4,
  points:{order:1,shift:5,onTime:2,weekOk:10,late:3,absent:15,early:3,weekMiss:10}};
let D={drivers:{},att:{},orders:{},settings:{}};
let user=null,unsubs=[],ready={},pending={},started=false,pendingRender=false;
/* ========== roles: manager (full) / supervisor (attendance, orders, drivers) ========== */
let ROLES={managers:[],supervisors:[]};
const myEmail=()=>String((user&&user.email)||'').toLowerCase();
function role(){const e=myEmail();if(!e)return 'none';if(e===OWNER||(ROLES.managers||[]).includes(e))return 'manager';if((ROLES.supervisors||[]).includes(e))return 'supervisor';return 'none'}
const isMgr=()=>role()==='manager';
const ROLE_LBL={manager:'مدير',supervisor:'مشرف',none:'—'};
const cfg=()=>({...DEFAULTS,...D.settings,shifts:{m:{...DEFAULTS.shifts.m,...((D.settings.shifts||{}).m||{})},e:{...DEFAULTS.shifts.e,...((D.settings.shifts||{}).e||{})}},points:{...DEFAULTS.points,...(D.settings.points||{})}});
const stamp=()=>({updatedBy:(user&&user.email)||'',updatedAt:Date.now()});
const dayRef=ds=>doc(db,'days',ds);
const recKey=r=>`${r.shift}_${r.driverId}`;
const APPF=['source','inLat','inLng','inAcc','inDist','outLat','outLng','outDist'];
const cleanRec=r=>{const o={driverId:r.driverId,shift:r.shift,status:r.status,checkIn:r.checkIn||null,checkOut:r.checkOut||null,note:r.note||'',updatedBy:r.updatedBy||'',updatedAt:r.updatedAt||0};APPF.forEach(k=>{if(r[k]!==undefined&&r[k]!==null)o[k]=r[k]});return o};
function W(p){return p.catch(e=>{console.error(e);toast(e&&e.code==='permission-denied'?'لا تملك صلاحية الحفظ — راجع قواعد Firestore':'تعذر الحفظ: '+((e&&e.code)||e))})}

/* ========== sync status ========== */
function updateSync(){
  const el=$('#sync');if(!el)return;
  let cls='',t='متزامن';
  if(!navigator.onLine){cls='off';t='بدون إنترنت — يُحفظ على الجهاز'}
  else if(Object.values(pending).some(Boolean)){cls='wait';t='جاري الرفع…'}
  el.className='pill '+cls;el.lastElementChild.textContent=t;
}
addEventListener('online',updateSync);addEventListener('offline',updateSync);

/* ========== state ========== */
function defaultDateShift(){
  const c=cfg(),n=new Date(),now=n.getHours()*60+n.getMinutes();
  const eS=toMin(c.shifts.e.start);let eE=toMin(c.shifts.e.end);if(eE<=eS)eE+=1440;
  if(now<Math.max(240,eE-1440+120))return{date:addDays(todayStr(),-1),shift:'e'};
  return{date:todayStr(),shift:now<eS?'m':'e'};
}
const S={view:'track',date:todayStr(),shift:'m',q:'',month:monthOf(todayStr())};

/* ========== domain ========== */
const activeDrivers=()=>Object.values(D.drivers).filter(d=>d.active!==false).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'en',{numeric:true}));
const recId=(ds,sh,id)=>`${ds}_${sh}_${id}`;
const getRec=(ds,sh,id)=>D.att[recId(ds,sh,id)];
const recs=()=>Object.values(D.att);
function bounds(ds,sh){const d=parseD(ds),c=cfg().shifts[sh];const s=toMin(c.start);let e=toMin(c.end);if(e<=s)e+=1440;const mk=m=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,m).getTime();return{start:mk(s),end:mk(e)}}
function derive(r){const b=bounds(r.date,r.shift);r.lateMin=r.status==='present'&&r.checkIn?Math.max(0,Math.round((r.checkIn-b.start)/60000)):0;r.earlyMin=r.status==='present'&&r.checkOut?Math.max(0,Math.round((b.end-r.checkOut)/60000)):0;return r}
const isLate=r=>r.status==='present'&&(r.lateMin||0)>cfg().grace;
const isEarly=r=>r.status==='present'&&!!r.checkOut&&(r.earlyMin||0)>cfg().grace;
function weeksOf(m){const res=[],[y,mo]=m.split('-').map(Number),last=new Date(y,mo,0).getDate(),td=todayStr();
  for(let day=1;day<=last;day++){const ds=`${m}-${pad(day)}`;if(parseD(ds).getDay()===5&&ds<td)res.push([addDays(ds,-6),ds])}return res}
function driverRange(id){
  const d=D.drivers[id],dates=recs().filter(x=>x.driverId===id).map(x=>x.date).sort();
  const start=(d&&d.createdAt)||dates[0]||null;
  const stop=d&&d.active===false?(d.stoppedAt||dates[dates.length-1]||start):null;
  return{start,stop};
}
function points(id,m){
  const c=cfg(),P=c.points,R=recs().filter(r=>r.driverId===id&&monthOf(r.date)===m),pr=R.filter(r=>r.status==='present');
  let orders=0;Object.keys(D.orders).forEach(ds=>{if(monthOf(ds)===m)orders+=num((D.orders[ds]||{})[id])});
  let wOk=0,wMiss=0;const{start,stop}=driverRange(id);
  /* الإجازة/العذر تُحسب ضمن الحد الأسبوعي، والأسابيع بعد إيقاف المندوب لا تُحسب */
  if(start)weeksOf(m).forEach(([ws,we])=>{if(ws<start)return;if(stop&&we>stop)return;
    const n=recs().filter(r=>r.driverId===id&&(r.status==='present'||r.status==='leave')&&r.date>=ws&&r.date<=we).length;n>=c.minShifts?wOk++:wMiss++});
  const items=[['طلبيات مكتملة',orders,num(P.order)],['فترات حضور',pr.length,num(P.shift)],['دخول في الوقت',pr.filter(r=>!isLate(r)).length,num(P.onTime)],[`أسابيع مكتملة (${c.minShifts}+ فترات)`,wOk,num(P.weekOk)],
    ['مرات تأخير',pr.filter(isLate).length,-num(P.late)],['غياب بدون عذر',R.filter(r=>r.status==='absent').length,-num(P.absent)],['خروج قبل نهاية الفترة',pr.filter(isEarly).length,-num(P.early)],['أسابيع ناقصة',wMiss,-num(P.weekMiss)]];
  const plus=items.filter(i=>i[2]>0).reduce((a,i)=>a+i[1]*i[2],0),minus=items.filter(i=>i[2]<0).reduce((a,i)=>a+i[1]*i[2],0);
  return{items,plus,minus,total:plus+minus};
}
function dayPoints(r){const P=cfg().points;if(r.status==='absent')return -num(P.absent);if(r.status!=='present')return 0;return num(P.shift)+(isLate(r)?-num(P.late):num(P.onTime))-(isEarly(r)?num(P.early):0)}
const ordersOf=(ds,id)=>(D.orders[ds]||{})[id];

/* ========== writes (offline-first: local first, Firestore queues when offline) ========== */
function saveRec(r){
  const n=derive({...r,...stamp()});D.att[n.id]=n;render();
  W(setDoc(dayRef(n.date),{recs:{[recKey(n)]:cleanRec(n)}},{merge:true}));
}
function delRec(id){const r=D.att[id];if(!r)return;delete D.att[id];render();W(setDoc(dayRef(r.date),{recs:{[recKey(r)]:deleteField()}},{merge:true}))}
function newRec(id,status){return{id:recId(S.date,S.shift,id),driverId:id,date:S.date,shift:S.shift,status,checkIn:null,checkOut:null,note:''}}
function setOrder(ds,id,v){
  D.orders[ds]=D.orders[ds]||{};
  if(v===''){delete D.orders[ds][id];W(setDoc(dayRef(ds),{orders:{[id]:deleteField()}},{merge:true}))}
  else{const n=Math.max(0,Math.round(num(v)));D.orders[ds][id]=n;W(setDoc(dayRef(ds),{orders:{[id]:n}},{merge:true}))}
}

function monthStats(m){
  const R=recs().filter(r=>monthOf(r.date)===m);
  const ids=new Set([...activeDrivers().map(d=>d.id),...R.map(r=>r.driverId)]);
  Object.keys(D.orders).filter(ds=>monthOf(ds)===m).forEach(ds=>Object.keys(D.orders[ds]).forEach(id=>ids.add(id)));
  const rows=[...ids].filter(id=>D.drivers[id]).map(id=>{
    const r=R.filter(x=>x.driverId===id),p=r.filter(x=>x.status==='present');
    const days=new Set(p.map(x=>x.date)).size;
    const late=p.filter(isLate);
    const hours=p.reduce((a,x)=>a+(x.checkIn&&x.checkOut?(x.checkOut-x.checkIn)/3600000:0),0);
    let orders=0;Object.keys(D.orders).forEach(ds=>{if(monthOf(ds)===m)orders+=num((D.orders[ds]||{})[id])});
    const pts=points(id,m);
    return{d:D.drivers[id],pts,early:p.filter(isEarly).length,days,shifts:p.length,absent:r.filter(x=>x.status==='absent').length,leave:r.filter(x=>x.status==='leave').length,
      late:late.length,lateMin:late.reduce((a,x)=>a+x.lateMin,0),hours,orders,avg:days?orders/days:0,openOut:p.filter(x=>!x.checkOut).length};
  });
  rows.sort((a,b)=>b.pts.total-a.pts.total||b.orders-a.orders||a.late-b.late);
  return rows;
}

/* ========== nav ========== */
const ICONS={
  att:'<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.4V6h-2v7.6l5 3 1-1.7z"/>',
  orders:'<path d="M20 6h-3V4a2 2 0 00-2-2H9a2 2 0 00-2 2v2H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zM9 4h6v2H9zm1.5 13L7 13.5l1.4-1.4 2.1 2.1 5.1-5.1 1.4 1.4z"/>',
  month:'<path d="M3 21h18v-2H3zm2-4h3V9H5zm5.5 0h3V4h-3zM16 17h3v-5h-3z"/>',
  shifts:'<path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5V8h14zM7 10h5v5H7z"/>',
  track:'<path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>',
  drivers:'<path d="M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/>',
  settings:'<path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.4-2.5 1a7 7 0 00-1.7-1L15 3h-4l-.4 2.6a7 7 0 00-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.4 2.5-1a7 7 0 001.7 1L11 21h4l.4-2.6a7 7 0 001.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>'
};
const VIEWS=[['track','التتبع المباشر'],['shifts','سجل الفترات'],['drivers','المندوبين'],['settings','الإعدادات']];
const SHORT={track:'الخريطة',shifts:'الفترات',drivers:'المندوبين',settings:'الإعدادات'};
const allowedViews=()=>VIEWS.map(v=>v[0]);
const viewTitle=k=>k==='settings'&&!isMgr()?'الحساب':VIEWS.find(v=>v[0]===k)[1];
const navHTML=s=>VIEWS.filter(v=>allowedViews().includes(v[0])).map(([k,t])=>`<button class="nav ${S.view===k?'on':''}" data-view="${k}"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[k]}</svg><span>${k==='settings'&&!isMgr()?'الحساب':(s?SHORT[k]:t)}</span></button>`).join('');
function tick(){const d=new Date();const c=$('#clock');if(c)c.textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}`}

function scheduleRender(){
  const a=document.activeElement;
  if(a&&a.classList&&a.classList.contains('ord')){pendingRender=true;return}
  render();
}
function render(){
  if(!started)return;
  if(!allowedViews().includes(S.view))S.view='track';
  $('#sideNav').innerHTML=navHTML(false);$('#botNav').innerHTML=navHTML(true);
  $('#title').textContent=viewTitle(S.view);
  const w=$('#who');if(w)w.innerHTML=`${esc(myEmail())}<br><span class="chip ${isMgr()?'c-y':'c-g'}">${ROLE_LBL[role()]}</span>`;$('#subtitle').textContent=dayLabel(todayStr());
  const focusQ=document.activeElement&&document.activeElement.id==='q';
  if(S.view==='track'){if(!$('#trackRoot')){$('#view').innerHTML=vTrack();initTrack()}else paintTrack();updateSync();return}
  if(MAP){try{MAP.remove()}catch(e){}MAP=null;MK={};TRK=null}
  $('#view').innerHTML=({shifts:vShifts,drivers:vDrivers,settings:vSettings}[S.view])();
  if(focusQ){const q=$('#q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length)}}
  updateSync();
}
const emptyDrivers=()=>`<div class="card empty"><b>لا يوجد مندوبين بعد</b>ابدأ بإضافة المندوبين، ثم أنشئ لكل واحد حساباً في تطبيق المندوب. ويمكن استيراد قائمة المندوبين من نسخة احتياطية لمنصة الحضور.<div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn p" data-act="newDriver">+ إضافة مندوب</button> ${isMgr()?'<button class="btn" data-view="settings">استيراد المندوبين</button>':''}</div></div>`;
const dateBar=(extra='')=>`<div class="tools">
  <button class="btn sm" data-act="day" data-n="-1">‹ اليوم السابق</button>
  <input type="date" class="inp" id="datePick" value="${S.date}">
  <button class="btn sm" data-act="day" data-n="1">اليوم التالي ›</button>
  ${S.date!==todayStr()?'<button class="btn sm" data-act="today">العودة لليوم</button>':''}${extra}</div>`;

/* ========== attendance ========== */
function vAtt(){
  const drv=activeDrivers();if(!drv.length)return emptyDrivers();
  const{date,shift}=S,c=cfg();
  const q=S.q.trim().toLowerCase();
  const list=drv.filter(d=>!q||String(d.name).toLowerCase().includes(q)||String(d.code||'').toLowerCase().includes(q));
  const pref=d=>d.shift===shift||d.shift==='both'?0:1;list.sort((a,b)=>pref(a)-pref(b));
  const R=drv.map(d=>getRec(date,shift,d.id)).filter(Boolean);
  const cnt=k=>R.filter(r=>r.status===k).length;
  const inNow=R.filter(r=>r.status==='present'&&!r.checkOut).length;
  const rows=list.map(d=>{
    const r=getRec(date,shift,d.id);let chip='<span class="chip c-m">لم يُسجَّل</span>',times='',acts='';
    if(r){chip=`<span class="chip ${ST[r.status][1]}">${ST[r.status][0]}</span>`;
      if(r.status==='present'){
        if(isLate(r))chip+=` <span class="chip c-a">متأخر ${dur(r.lateMin)}</span>`;
        if(isEarly(r))chip+=` <span class="chip c-a">خروج مبكر ${dur(r.earlyMin)}</span>`;
        chip+=r.checkOut?' <span class="chip c-m">انصرف</span>':' <span class="chip c-g">في الدوام</span>';
        if(r.source==='app'){const rad=(cfg().office||{}).radius||200;chip+=` <span class="chip c-b">📱 التطبيق</span>`;if(r.inDist!=null)chip+=r.inDist<=rad?' <span class="chip c-g">دخل من المكتب</span>':` <span class="chip c-a">دخل على بعد ${fmtDist(r.inDist)}</span>`;if(r.checkOut&&r.outDist!=null&&r.outDist>rad)chip+=` <span class="chip c-m">خرج على بعد ${fmtDist(r.outDist)}</span>`}
        times=`<div class="times"><span>دخول <b>${hm(r.checkIn)}</b></span><span>خروج <b>${hm(r.checkOut)}</b></span>${r.checkOut?`<span>المدة <b>${dur((r.checkOut-r.checkIn)/60000)}</b></span>`:''}</div>`;
      }
      if(r.note)times+=`<div class="mu" style="margin-top:2px">📝 ${esc(r.note)}</div>`;
    }
    if(!r||r.status!=='present')acts+=`<button class="btn sm p" data-act="in" data-d="${d.id}">تسجيل دخول</button>`;
    if(r&&r.status==='present'&&!r.checkOut)acts+=`<button class="btn sm o" data-act="out" data-d="${d.id}">تسجيل خروج</button>`;
    if(!r)acts+=`<button class="btn sm d" data-act="absent" data-d="${d.id}">غياب</button><button class="btn sm" data-act="leave" data-d="${d.id}">إجازة</button>`;
    if(r)acts+=`<button class="btn sm" data-act="edit" data-id="${r.id}" title="تعديل">✎ تعديل</button>`;
    return `<div class="drv"><div class="av">${initials(d.name)}</div><div class="grow"><div class="row" style="flex-wrap:wrap;gap:6px"><span class="nm">${esc(d.name)}</span><span class="mu">${esc(d.code||'')}</span>${pref(d)?'<span class="chip c-m">خارج فترته المعتادة</span>':''}</div><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${chip}</div>${times}</div><div class="acts">${acts}</div></div>`;
  }).join('');
  const missing=drv.filter(d=>(d.shift===shift||d.shift==='both')&&!getRec(date,shift,d.id)).length;
  return dateBar(`<div class="seg"><button class="${shift==='m'?'on':''}" data-act="shift" data-s="m">الصباحية</button><button class="${shift==='e'?'on':''}" data-act="shift" data-s="e">المسائية</button></div>
    <input class="inp grow" id="q" placeholder="بحث بالاسم أو الرقم…" value="${esc(S.q)}" style="min-width:160px"><button class="btn sm" data-act="summary">📤 ملخص اليوم</button>`)+
  alertsHTML()+
  `<div class="grid k4" style="margin-bottom:12px">
    <div class="card kpi g"><div class="l">في الدوام الآن</div><div class="v">${inNow}</div></div>
    <div class="card kpi b"><div class="l">حاضرين</div><div class="v">${cnt('present')}</div></div>
    <div class="card kpi a"><div class="l">متأخرين</div><div class="v">${R.filter(isLate).length}</div></div>
    <div class="card kpi r"><div class="l">غياب</div><div class="v">${cnt('absent')}</div></div>
  </div>
  <div class="row mu" style="margin-bottom:10px;flex-wrap:wrap;gap:8px"><span>${dayLabel(date)} · الفترة ${SH[shift]} ${c.shifts[shift].start} – ${endLabel(c.shifts[shift])} · سماحية ${c.grace} د</span>
  ${missing&&Date.now()>bounds(date,shift).start?`<button class="btn sm d" data-act="absentRest" style="margin-inline-start:auto">تسجيل غياب لمن لم يحضر (${missing})</button>`:''}</div>
  ${rows||'<div class="card empty">لا نتائج مطابقة</div>'}`;
}
function editRec(id){
  const r=D.att[id];if(!r)return;const d=D.drivers[r.driverId]||{name:'—'};
  $('#sheet').innerHTML=`<h3>${esc(d.name)}</h3><div class="mu">${dayLabel(r.date)} · الفترة ${SH[r.shift]}</div>
  <form id="recForm"><div class="fg">
    <label>الحالة<select class="inp" name="status">${Object.entries(ST).map(([k,[l]])=>`<option value="${k}" ${r.status===k?'selected':''}>${l}</option>`).join('')}</select></label><span></span>
    <label>وقت الدخول<input class="inp" type="time" name="in" value="${r.checkIn?hm(r.checkIn):''}"></label>
    <label>وقت الخروج<input class="inp" type="time" name="out" value="${r.checkOut?hm(r.checkOut):''}"></label>
    <label class="full">ملاحظة<input class="inp" name="note" value="${esc(r.note||'')}" placeholder="مثال: استأذن ساعة، عطل في الدراجة…"></label>
  </div>
  ${r.updatedBy?`<div class="mu" style="margin-top:10px;font-size:11.5px">آخر تعديل: ${esc(r.updatedBy)}${r.updatedAt?' · '+new Date(r.updatedAt).toLocaleString('ar-LY'):''}</div>`:''}
  <div class="mfoot"><button class="btn p" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button><button class="btn d" type="button" data-act="delRec" data-id="${r.id}" style="margin-inline-start:auto">حذف التسجيل</button></div></form>`;
  $('#recForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),n={...r};
    n.status=f.get('status');n.note=String(f.get('note')||'').slice(0,300);
    const day=parseD(r.date),st=toMin(cfg().shifts[r.shift].start);
    const at=(t,ref)=>{if(!t)return null;let m=toMin(t);if(m<st-180)m+=1440;let ms=new Date(day.getFullYear(),day.getMonth(),day.getDate(),0,m).getTime();if(ref&&ms<ref)ms+=86400000;return ms};
    if(n.status==='present'){n.checkIn=at(f.get('in'));n.checkOut=at(f.get('out'),n.checkIn);if(!n.checkIn)return toast('أدخل وقت الدخول')}else{n.checkIn=n.checkOut=null}
    closeModal();saveRec(n);toast('تم الحفظ')};
  openModal();
}

/* ========== alerts: incomplete records in the last 7 days ========== */
function alerts(){
  const now=Date.now(),td=todayStr(),out=[],H=3600000;
  for(let i=0;i<=7;i++){const ds=addDays(td,-i);
    ['m','e'].forEach(sh=>{const b=bounds(ds,sh);if(now<b.end+H)return;
      recs().filter(r=>r.date===ds&&r.shift===sh&&r.status==='present'&&!r.checkOut&&D.drivers[r.driverId]).forEach(r=>
        out.push({k:'out',t:`${D.drivers[r.driverId].name}: لم يُسجَّل خروجه — ${dayLabel(ds)} · ${SH[sh]}`,id:r.id}));
      const miss=activeDrivers().filter(d=>(d.shift===sh||d.shift==='both')&&(!d.createdAt||d.createdAt<=ds)&&!getRec(ds,sh,d.id));
      if(miss.length)out.push({k:'att',t:`${dayLabel(ds)} · ${SH[sh]}: ${miss.length} مندوب بدون تسجيل (${miss.slice(0,3).map(d=>d.name).join('، ')}${miss.length>3?'…':''})`,ds,sh});
    });
    if(ds<td||now>bounds(ds,'e').end+H){
      const worked=Object.values(D.drivers).filter(d=>['m','e'].some(sh=>{const r=getRec(ds,sh,d.id);return r&&r.status==='present'}));
      const noOrd=worked.filter(d=>ordersOf(ds,d.id)==null||ordersOf(ds,d.id)==='');
      if(noOrd.length)out.push({k:'ord',t:`${dayLabel(ds)}: لم تُدخَل طلبيات ${noOrd.length} من ${worked.length} مندوب`,ds});
    }
  }
  const pr={out:0,ord:1,att:2};
  return out.map((x,i)=>[x,i]).sort((p,q)=>pr[p[0].k]-pr[q[0].k]||p[1]-q[1]).map(p=>p[0]);
}
function alertsHTML(){
  const A=alerts();if(!A.length)return '';
  const show=S.allAlerts?A:A.slice(0,5);
  const ic={out:'⏱️',att:'👤',ord:'📦'};
  return `<div class="card" style="margin-bottom:12px;border-color:rgba(245,165,36,.45);background:rgba(245,165,36,.06)">
  <div class="sec" style="margin:0 0 6px;color:var(--amb)">⚠️ تسجيلات تحتاج مراجعة (${A.length})<span class="mu" style="font-weight:600">آخر 7 أيام</span></div>
  ${show.map(a=>`<button class="alrt" data-act="alert" data-k="${a.k}" data-id="${esc(a.id||'')}" data-ds="${esc(a.ds||'')}" data-sh="${esc(a.sh||'')}"><span>${ic[a.k]}</span><span class="grow">${esc(a.t)}</span><span class="mu">‹</span></button>`).join('')}
  ${A.length>5?`<button class="btn sm" style="margin-top:6px" data-act="allAlerts">${S.allAlerts?'إخفاء':'عرض الكل (+'+(A.length-5)+')'}</button>`:''}</div>`;
}

/* ========== daily summary (WhatsApp) ========== */
function summaryText(ds){
  const lines=[`📋 ملخص يوم ${dayLabel(ds)} — سبيدي`,''];
  const late=[],abs=[],lv=[];
  ['m','e'].forEach(sh=>{
    const R=recs().filter(r=>r.date===ds&&r.shift===sh&&D.drivers[r.driverId]);if(!R.length)return;
    const P=R.filter(r=>r.status==='present'),L=P.filter(isLate);
    lines.push(`${sh==='m'?'🌅':'🌙'} الفترة ${SH[sh]}: حاضر ${P.length} | متأخر ${L.length} | غياب ${R.filter(r=>r.status==='absent').length} | إجازة ${R.filter(r=>r.status==='leave').length}`);
    L.forEach(r=>late.push(`${D.drivers[r.driverId].name} (${dur(r.lateMin)}${sh==='e'?' مسائي':''})`));
    R.filter(r=>r.status==='absent').forEach(r=>abs.push(D.drivers[r.driverId].name));
    R.filter(r=>r.status==='leave').forEach(r=>lv.push(D.drivers[r.driverId].name+(r.note?` — ${r.note}`:'')));
  });
  if(lines.length===2)lines.push('لا توجد تسجيلات حضور لهذا اليوم.');
  const O=Object.entries(D.orders[ds]||{}).filter(([id,v])=>D.drivers[id]&&v!==''&&v!=null);
  if(O.length){const tot=O.reduce((a,[,v])=>a+num(v),0);const top=O.sort((a,b)=>num(b[1])-num(a[1]))[0];
    lines.push('',`📦 مجموع الطلبيات المكتملة: ${tot} (${O.length} مندوب)`,`🏆 الأعلى طلبيات: ${D.drivers[top[0]].name} (${top[1]})`)}
  if(late.length)lines.push('',`⏰ المتأخرون: ${late.join('، ')}`);
  if(abs.length)lines.push(`❌ الغياب: ${abs.join('، ')}`);
  if(lv.length)lines.push(`🟦 الإجازات: ${lv.join('، ')}`);
  lines.push('','سبيدي.. طلبيتك في إيدي');
  return lines.join('\n');
}
function showSummary(){
  const t=summaryText(S.date);
  $('#sheet').innerHTML=`<h3>ملخص اليوم</h3><div class="mu">${dayLabel(S.date)} — جاهز للإرسال على الواتساب</div>
  <textarea class="inp" id="sumTxt" readonly style="width:100%;height:280px;margin-top:12px;line-height:1.8;resize:vertical">${esc(t)}</textarea>
  <div class="mfoot"><button class="btn p" data-act="sumCopy">نسخ النص</button><button class="btn" data-act="sumWa" style="background:#25D366;border-color:#25D366;color:#fff">إرسال واتساب</button>${navigator.share?'<button class="btn" data-act="sumShare">مشاركة</button>':''}<button class="btn" data-act="close" style="margin-inline-start:auto">إغلاق</button></div>`;
  openModal();
}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch(e){const x=$('#sumTxt');if(x){x.select();try{return document.execCommand('copy')}catch(_){}}return false}}

/* ========== live tracking (Realtime Database + Leaflet map) ========== */
let LIVE={},liveUnsub=null,MAP=null,MK={},TRK=null,officeLayer=null,leafletP=null;
const TS={mode:'live',date:todayStr(),driver:'',focus:''};
const STALE_MIN=5;
function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  if(leafletP)return leafletP;
  leafletP=new Promise((res,rej)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(css);
    const sc=document.createElement('script');sc.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';sc.onload=()=>res(window.L);sc.onerror=()=>{leafletP=null;rej(new Error('leaflet'))};document.head.appendChild(sc);
  });
  return leafletP;
}
function startLive(){
  if(liveUnsub||!rtdb)return;
  liveUnsub=onValue(dbRef(rtdb,'live'),s=>{LIVE=s.val()||{};if(S.view==='track')paintTrack()},err=>{console.error(err);liveUnsub=null;
    const e=$('#trkErr');if(e)e.innerHTML=`<div class="card" style="border-color:rgba(239,83,80,.5);margin-bottom:12px">⛔ تعذر قراءة المواقع (${esc(err.code||err.message)}). ${isMgr()?'افتح الصفحة مرة أخرى بعد دقيقة، أو راجع قواعد Realtime Database.':'اطلب من المدير فتح صفحة التتبع مرة واحدة لتفعيل صلاحيتك.'}</div>`});
  unsubs.push(()=>{if(liveUnsub){liveUnsub();liveUnsub=null}});
}
const fmtDist=m=>m==null||!isFinite(m)?'—':m<1000?`${Math.round(m)} م`:`${(m/1000).toFixed(1)} كم`;
function haversine(a,b){const R=6371000,r=x=>x*Math.PI/180;const dLa=r(b.lat-a.lat),dLo=r(b.lng-a.lng);const h=Math.sin(dLa/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const agoTxt=ms=>{if(!ms)return '—';const s=Math.max(0,Math.round((Date.now()-ms)/1000));return s<60?`${s} ث`:s<3600?`${Math.floor(s/60)} د`:s<86400?`${Math.floor(s/3600)} س`:`${Math.floor(s/86400)} يوم`};
function liveState(v){
  if(!v)return['off','لا يوجد','c-m','#5f6b66'];
  if(!v.active)return['off','خارج الفترة','c-m','#5f6b66'];
  const seen=v.at||v.t||0;
  if(Date.now()-seen>STALE_MIN*60000)return['lost','انقطع الاتصال','c-r','#ef5350'];
  if((v.spd||0)>=1.5)return['move','يتحرك','c-g','#19c98a'];
  return['stop','متوقف','c-a','#f5a524'];
}
function vTrack(){
  if(!rtdb)return `<div class="card empty"><b>التتبع غير مفعّل بعد</b>أضف رابط Realtime Database (databaseURL) في الملف js/firebase-config.js.</div>`;
  const drv=Object.values(D.drivers).filter(d=>d.active!==false).sort((a,b)=>String(a.code||'').localeCompare(String(b.code||''),'en',{numeric:true}));
  return `<div id="trackRoot">
  <div class="tools"><div class="seg"><button data-act="tmode" data-m="live" class="${TS.mode==='live'?'on':''}">مباشر</button><button data-act="tmode" data-m="hist" class="${TS.mode==='hist'?'on':''}">مسار يوم</button></div>
    <span id="histTools" class="tools" style="margin:0;${TS.mode==='hist'?'':'display:none'}"><input type="date" class="inp" id="tDate" value="${TS.date}"><select class="inp" id="tDriver"><option value="">— اختر المندوب —</option>${drv.map(d=>`<option value="${esc(d.id)}" ${TS.driver===d.id?'selected':''}>${esc(d.name)} ${esc(d.code||'')}</option>`).join('')}</select></span></div>
  <div id="trkErr"></div>
  <div class="grid k4" style="margin-bottom:12px" id="tKpi"></div>
  <div class="trk"><div class="card" style="padding:0;overflow:hidden"><div id="map"></div></div><div class="card" style="padding:10px"><div class="sec" style="margin:4px 6px 8px" id="tListTitle">المندوبون</div><div id="tList"></div></div></div>
  </div>`;
}
async function initTrack(){
  startLive();if(isMgr())maintainTracking();
  try{await loadLeaflet()}catch(e){$('#map').innerHTML='<div class="empty">تعذر تحميل الخريطة — تحقق من الإنترنت</div>';paintTrack();return}
  if(!$('#map'))return;
  MAP=L.map('map',{zoomControl:true,attributionControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(MAP);
  const off=cfg().office;
  MAP.setView(off&&isFinite(off.lat)?[off.lat,off.lng]:[32.8872,13.1913],13);
  drawOffice();
  if(TS.mode==='hist')loadHistory();
  paintTrack(true);
}
function drawOffice(){
  if(!MAP)return;if(officeLayer){officeLayer.remove();officeLayer=null}
  const o=cfg().office;if(!o||!isFinite(o.lat))return;
  officeLayer=L.layerGroup([L.circle([o.lat,o.lng],{radius:o.radius||200,color:'#d4af37',weight:1.5,fillOpacity:.06}),
    L.marker([o.lat,o.lng],{icon:L.divIcon({className:'',html:'<div class="mk off">🏢</div>',iconSize:[30,30],iconAnchor:[15,15]})}).bindTooltip('المكتب')]).addTo(MAP);
}
function paintTrack(fit){
  if(!$('#trackRoot'))return;
  const ids=[...new Set([...Object.keys(LIVE),...Object.values(D.drivers).filter(d=>d.active!==false&&d.appLogin).map(d=>d.id)])].filter(id=>D.drivers[id]||LIVE[id]);
  const rows=ids.map(id=>{const v=LIVE[id],d=D.drivers[id]||{name:(v&&v.name)||id,code:(v&&v.code)||''};const st=liveState(v);return{id,v,d,st}});
  const ord={move:0,stop:1,lost:2,off:3};rows.sort((a,b)=>ord[a.st[0]]-ord[b.st[0]]||String(a.d.code||'').localeCompare(String(b.d.code||''),'en',{numeric:true}));
  const cnt=k=>rows.filter(r=>r.st[0]===k).length,off=cfg().office;
  $('#tKpi').innerHTML=TS.mode==='live'?`<div class="card kpi g"><div class="l">يتحرك</div><div class="v">${cnt('move')}</div></div><div class="card kpi a"><div class="l">متوقف</div><div class="v">${cnt('stop')}</div></div><div class="card kpi r"><div class="l">انقطع الاتصال</div><div class="v">${cnt('lost')}</div></div><div class="card kpi"><div class="l">خارج الفترة</div><div class="v">${cnt('off')}</div></div>`:'';
  if(TS.mode==='live'){
    $('#tListTitle').textContent=`المندوبون (${rows.filter(r=>r.st[0]!=='off').length} في الفترة)`;
    $('#tList').innerHTML=rows.length?rows.map(r=>{const v=r.v;const dist=off&&v&&isFinite(off.lat)?haversine(v,off):null;
      return `<button class="tdrv ${TS.focus===r.id?'on':''}" data-act="tfocus" data-d="${esc(r.id)}"><span class="av" style="color:${r.st[3]}">${initials(r.d.name)}</span><span class="grow"><b>${esc(r.d.name)}</b> <span class="mu">${esc(r.d.code||'')}</span><br><span class="chip ${r.st[2]}">${r.st[1]}</span>${v&&v.mock?' <span class="chip c-r">⚠️ موقع وهمي</span>':''}
      <span class="mu">${v?` · ${v.active?'آخر تحديث منذ '+agoTxt(v.at||v.t):'آخر ظهور منذ '+agoTxt(v.endedAt||v.at||v.t)}${v.active&&v.spd>=1.5?' · '+Math.round(v.spd*3.6)+' كم/س':''}${v.active&&dist!=null?' · من المكتب '+fmtDist(dist):''}`:' · لم يستخدم التطبيق بعد'}</span></span></button>`}).join(''):`<div class="empty" style="padding:20px">لا يوجد مندوبون لديهم حساب في التطبيق بعد.<br>${isMgr()?'أنشئ حسابات من قسم «المندوبين».':''}</div>`;
  }
  if(!MAP||!window.L)return;
  if(TS.mode==='live'){
    if(TRK){TRK.remove();TRK=null}
    const seen=new Set();
    rows.forEach(r=>{const v=r.v;if(!v||!v.active||!isFinite(v.lat))return;seen.add(r.id);
      const html=`<div class="mk" style="background:${r.st[3]}">${initials(r.d.name)}</div>`;
      const tip=`<b>${esc(r.d.name)}</b><br>${r.st[1]} · منذ ${agoTxt(v.at||v.t)}${v.spd>=1.5?'<br>'+Math.round(v.spd*3.6)+' كم/س':''}<br>دقة ${v.acc||'—'} م`;
      if(MK[r.id]){MK[r.id].setLatLng([v.lat,v.lng]).setIcon(L.divIcon({className:'',html,iconSize:[32,32],iconAnchor:[16,16]}));MK[r.id].setTooltipContent(tip)}
      else MK[r.id]=L.marker([v.lat,v.lng],{icon:L.divIcon({className:'',html,iconSize:[32,32],iconAnchor:[16,16]})}).bindTooltip(tip).addTo(MAP);
    });
    Object.keys(MK).forEach(id=>{if(!seen.has(id)){MK[id].remove();delete MK[id]}});
    if(fit){const pts=Object.values(MK).map(m=>m.getLatLng());if(pts.length)MAP.fitBounds(L.latLngBounds(pts).pad(.3),{maxZoom:15})}
  }else{Object.values(MK).forEach(m=>m.remove());MK={}}
}
async function loadHistory(){
  if(!MAP)return;if(TRK){TRK.remove();TRK=null}
  const id=TS.driver,ds=TS.date,list=$('#tList');$('#tListTitle').textContent='مسار اليوم';
  if(!id){list.innerHTML='<div class="empty" style="padding:20px">اختر المندوب واليوم لعرض المسار.</div>';return}
  list.innerHTML='<div class="spin"></div>';
  let pts=[];
  try{const s=await dbGet(dbRef(rtdb,`tracks/${id}/${ds}`));pts=Object.values(s.val()||{}).filter(p=>p&&isFinite(p.lat)).sort((a,b)=>a.t-b.t)}
  catch(e){list.innerHTML=`<div class="empty">تعذر تحميل المسار (${esc(e.code||e.message)})</div>`;return}
  if(!pts.length){list.innerHTML=`<div class="empty" style="padding:20px">لا توجد نقاط لهذا المندوب في ${dayLabel(ds)}.</div>`;return}
  let dist=0,stops=[],mock=pts.some(p=>p.mock);
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if((a.acc||0)<100&&(b.acc||0)<100){const dd=haversine(a,b);if(dd<5000)dist+=dd}
    if(b.t-a.t>=10*60000)stops.push({at:a,mins:Math.round((b.t-a.t)/60000)})}
  const ll=pts.map(p=>[p.lat,p.lng]);
  TRK=L.layerGroup([L.polyline(ll,{color:'#19c98a',weight:4,opacity:.85}),
    L.circleMarker(ll[0],{radius:8,color:'#fff',weight:2,fillColor:'#00A86B',fillOpacity:1}).bindTooltip('البداية '+hm(pts[0].t)),
    L.circleMarker(ll[ll.length-1],{radius:8,color:'#fff',weight:2,fillColor:'#ef5350',fillOpacity:1}).bindTooltip('النهاية '+hm(pts[pts.length-1].t)),
    ...stops.map(s=>L.circleMarker([s.at.lat,s.at.lng],{radius:6,color:'#f5a524',weight:2,fillOpacity:.6}).bindTooltip(`توقف ${s.mins} د من ${hm(s.at.t)}`))]).addTo(MAP);
  MAP.fitBounds(L.latLngBounds(ll).pad(.2));
  const d=D.drivers[id]||{name:id};
  list.innerHTML=`<div style="padding:4px 6px;line-height:2"><b style="font-size:16px">${esc(d.name)}</b><div class="mu">${dayLabel(ds)}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">
    <div class="card kpi" style="padding:10px"><div class="l">المسافة</div><div class="v" style="font-size:20px">${fmtDist(dist)}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">المدة</div><div class="v" style="font-size:20px">${dur((pts[pts.length-1].t-pts[0].t)/60000)}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">من – إلى</div><div class="v" style="font-size:17px">${hm(pts[0].t)} – ${hm(pts[pts.length-1].t)}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">نقاط الموقع</div><div class="v" style="font-size:20px">${pts.length}</div></div></div>
    ${mock?'<div class="chip c-r">⚠️ بعض النقاط من موقع وهمي (Fake GPS)</div>':''}
    ${stops.length?`<div class="sec" style="margin:10px 0 4px">توقفات 10 دقائق فأكثر (${stops.length})</div>${stops.map(s=>`<div class="mu">⏸ ${hm(s.at.t)} — ${s.mins} د</div>`).join('')}`:'<div class="mu">لا توجد توقفات طويلة.</div>'}
    <div class="mu" style="margin-top:8px;font-size:11.5px">● أخضر: البداية · ● أحمر: النهاية · ● برتقالي: توقف</div></div>`;
}
/* keep RTDB permissions in sync with roles, and delete tracks older than 60 days (manager, once a day) */
async function syncStaff(){
  if(!rtdb||!isMgr())return;
  try{
    const want={};if(OWNER)want[ekey(OWNER)]='manager';
    (ROLES.supervisors||[]).forEach(e=>want[ekey(e)]='supervisor');(ROLES.managers||[]).forEach(e=>want[ekey(e)]='manager');
    const cur=(await dbGet(dbRef(rtdb,'staff'))).val()||{};const up={};
    Object.entries(want).forEach(([k,v])=>{if(cur[k]!==v)up['staff/'+k]=v});
    Object.keys(cur).forEach(k=>{if(!(k in want))up['staff/'+k]=null});
    if(Object.keys(up).length)await dbUpdate(dbRef(rtdb),up);
  }catch(e){console.warn('syncStaff',e)}
}
async function maintainTracking(){
  await syncStaff();
  const key='speedy_trk_cleanup',td=todayStr();
  try{if(localStorage.getItem(key)===td)return;localStorage.setItem(key,td)}catch(e){}
  const cutoff=addDays(td,-60);
  for(const id of Object.keys(D.drivers)){
    try{const s=await dbGet(dbQuery(dbRef(rtdb,`tracks/${id}`),orderByKey(),endAt(cutoff)));const v=s.val();
      if(v){const up={};Object.keys(v).forEach(k=>up[`tracks/${id}/${k}`]=null);await dbUpdate(dbRef(rtdb),up)}}catch(e){}
  }
}

/* ========== driver app accounts (manager) ========== */
const loginEmail=id=>`${String(id).trim().toLowerCase()}@${DRIVER_DOMAIN}`;
function appAccountForm(id){
  const d=D.drivers[id];if(!d)return;
  const sug=(d.appLogin?String(d.appLogin).replace(/-\d+$/,'')+'-'+((parseInt((String(d.appLogin).match(/-(\d+)$/)||[])[1])||1)+1):String(d.phone||'').replace(/\D/g,''))||String(d.code||'').toLowerCase();
  const pw=String(Math.floor(100000+Math.random()*900000));
  $('#sheet').innerHTML=`<h3>حساب تطبيق المندوب</h3><div class="mu">${esc(d.name)} ${esc(d.code||'')}</div>
  ${d.appLogin?`<div class="card" style="margin-top:12px;padding:12px">الحساب الحالي: <b dir="ltr">${esc(d.appLogin)}</b><div class="mfoot" style="margin-top:8px"><button class="btn sm d" data-act="appOff" data-d="${esc(id)}">إيقاف الحساب</button></div><div class="mu" style="font-size:12px;margin-top:6px">لتغيير كلمة المرور: أنشئ حساباً جديداً بالأسفل (يُوقف الحساب القديم تلقائياً).</div></div>`:''}
  <form id="appForm" data-d="${esc(id)}"><div class="fg">
    <label>رقم الدخول (أرقام أو حروف إنجليزية)<input class="inp" name="login" dir="ltr" required pattern="[A-Za-z0-9._\\-]{3,40}" value="${esc(sug)}"></label>
    <label>كلمة المرور<input class="inp" name="pw" dir="ltr" required minlength="6" value="${pw}"></label>
  </div><div class="mfoot"><button class="btn p" type="submit">${d.appLogin?'إنشاء حساب جديد':'إنشاء الحساب'}</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`;
  openModal();
}
async function createAppAccount(id,login,pw){
  const d=D.drivers[id];login=String(login).trim().toLowerCase();const email=loginEmail(login);
  try{const sa=getSecAuth();await createUserWithEmailAndPassword(sa,email,pw);await signOut(sa)}
  catch(e){const c=e.code||'';return toast(c.includes('email-already-in-use')?'رقم الدخول مستخدم من قبل — اختر رقماً آخر':c.includes('invalid-email')?'رقم الدخول غير صالح (أرقام وحروف إنجليزية فقط)':c.includes('weak-password')?'كلمة المرور 6 أحرف على الأقل':c.includes('network')?'إنشاء الحساب يحتاج إنترنت':'تعذر إنشاء الحساب: '+c)}
  if(d.appLogin&&d.appLogin!==login)await disableAppAccount(id,true);
  try{
    await setDoc(doc(db,'driverAccounts',email),{driverId:id,name:d.name||'',login,...stamp()});
    await setDoc(doc(db,'drivers',id),{appLogin:login},{merge:true});
    if(rtdb)await dbSet(dbRef(rtdb,`driverOf/${ekey(email)}`),id);
  }catch(e){return toast('أُنشئ الحساب لكن تعذر ربطه: '+(e.code||e.message))}
  D.drivers[id]={...d,appLogin:login};render();
  const apk=CONF.driverApkUrl||'';
  const msg=`مرحباً ${d.name}،\nهذا حسابك في تطبيق سبيدي للمندوبين:\nرقم الدخول: ${login}\nكلمة المرور: ${pw}\n${apk?'رابط تحميل التطبيق: '+apk+'\n':''}\nعند بداية الفترة اضغط «بدء الفترة»، وعند نهايتها «إنهاء الفترة». يُرسَل موقعك أثناء الفترة فقط.`;
  $('#sheet').innerHTML=`<h3>تم إنشاء الحساب ✓</h3><div class="mu">أرسل هذه البيانات للمندوب (كلمة المرور لا تظهر مرة أخرى):</div>
  <textarea class="inp" id="sumTxt" readonly style="width:100%;height:190px;margin-top:10px;line-height:1.8">${esc(msg)}</textarea>
  <div class="mfoot"><button class="btn p" data-act="sumCopy">نسخ</button><button class="btn" data-act="waTo" data-p="${esc(String(d.phone||'').replace(/\D/g,''))}" style="background:#25D366;border-color:#25D366;color:#fff">إرسال واتساب</button><button class="btn" data-act="close" style="margin-inline-start:auto">إغلاق</button></div>`;
  openModal();
}
async function disableAppAccount(id,silent){
  const d=D.drivers[id];if(!d||!d.appLogin)return;const email=loginEmail(d.appLogin);
  try{await deleteDoc(doc(db,'driverAccounts',email));await setDoc(doc(db,'drivers',id),{appLogin:null},{merge:true});if(rtdb)await dbRemove(dbRef(rtdb,`driverOf/${ekey(email)}`))}
  catch(e){return toast('تعذر الإيقاف: '+(e.code||e.message))}
  D.drivers[id]={...d,appLogin:null};if(!silent){closeModal();render();toast('أُوقف حساب التطبيق')}
}

/* ========== daily orders ========== */

function vOrders(){
  const drv=activeDrivers();if(!drv.length)return emptyDrivers();
  const ds=S.date;
  const worked=drv.filter(d=>['m','e'].some(sh=>{const r=getRec(ds,sh,d.id);return r&&r.status==='present'}));
  const others=drv.filter(d=>!worked.includes(d)&&ordersOf(ds,d.id)!=null&&ordersOf(ds,d.id)!=='');
  const list=[...worked,...others];
  const total=list.reduce((a,d)=>a+num(ordersOf(ds,d.id)),0);
  const filled=list.filter(d=>ordersOf(ds,d.id)!=null&&ordersOf(ds,d.id)!=='').length;
  const shifts=d=>['m','e'].filter(sh=>{const r=getRec(ds,sh,d.id);return r&&r.status==='present'}).map(sh=>SH[sh]).join(' + ');
  return dateBar('<button class="btn sm" data-act="summary">📤 ملخص اليوم</button>')+`<div class="grid k4" style="margin-bottom:12px">
    <div class="card kpi b"><div class="l">مندوبين اشتغلوا</div><div class="v">${worked.length}</div></div>
    <div class="card kpi y"><div class="l">مجموع الطلبيات المكتملة</div><div class="v" id="ordTotal">${total}</div></div>
    <div class="card kpi ${filled<list.length?'a':'g'}"><div class="l">تم إدخالهم</div><div class="v" id="ordFilled">${filled}/${list.length}</div></div>
  </div>
  ${list.length?`<div class="card"><div class="mu" style="margin-bottom:8px">اكتب عدد الطلبيات المكتملة لكل مندوب في ${dayLabel(ds)} — يُحفظ تلقائياً. استخدم Enter للانتقال للمندوب التالي.</div>
  <table><thead><tr><th>المندوب</th><th>الفترة</th><th style="width:160px">الطلبيات المكتملة</th></tr></thead><tbody>
  ${list.map(d=>`<tr><td><b>${esc(d.name)}</b> <span class="mu">${esc(d.code||'')}</span></td><td class="mu">${shifts(d)||'—'}</td><td><input class="inp ord" type="number" min="0" inputmode="numeric" data-d="${d.id}" value="${ordersOf(ds,d.id)??''}" style="width:120px;font-weight:800;font-size:16px;text-align:center"></td></tr>`).join('')}
  </tbody></table></div>`:`<div class="card empty"><b>لا يوجد حضور مسجّل في هذا اليوم</b>سجّل حضور المندوبين أولاً من صفحة الحضور والانصراف.</div>`}`;
}

/* ========== monthly report ========== */
function monthOpts(sel){const o=[];let c=monthOf(todayStr());for(let i=0;i<12;i++){o.push(c);c=prevMonth(c)}return o.map(m=>`<option value="${m}" ${m===sel?'selected':''}>${monthLabel(m)}</option>`).join('')}
function vMonth(){
  const rows=monthStats(S.month);if(!rows.length)return `<div class="tools"><select class="inp" id="monthPick">${monthOpts(S.month)}</select></div><div class="card empty"><b>لا توجد بيانات لهذا الشهر</b></div>`;
  const T=k=>rows.reduce((a,r)=>a+r[k],0);
  const medals=['🥇','🥈','🥉'];const top=rows.filter(r=>r.pts.total>0).slice(0,3);
  return `<div class="tools noprint"><select class="inp" id="monthPick">${monthOpts(S.month)}</select>
    <button class="btn p" data-act="pdf">📄 تقرير PDF</button><button class="btn" data-act="csv">تنزيل Excel</button><span class="mu">اضغط على أي مندوب لعرض تفاصيله يوم بيوم</span></div>
  <h2 class="printonly">تقرير المندوبين — ${monthLabel(S.month)} — سبيدي</h2>
  <div class="grid k4" style="margin-bottom:12px">
    <div class="card kpi b"><div class="l">أيام حضور (مجموع)</div><div class="v">${T('days')}</div></div>
    <div class="card kpi r"><div class="l">غياب</div><div class="v">${T('absent')}</div></div>
    <div class="card kpi a"><div class="l">مرات التأخير</div><div class="v">${T('late')}</div><div class="h">${dur(T('lateMin'))}</div></div>
    <div class="card kpi g"><div class="l">ساعات العمل</div><div class="v">${Math.round(T('hours'))}</div></div>
    <div class="card kpi y"><div class="l">الطلبيات المكتملة</div><div class="v">${T('orders')}</div></div>
    <div class="card kpi g"><div class="l">مجموع نقاط الأسطول</div><div class="v">${rows.reduce((a,r)=>a+r.pts.total,0)}</div></div>
  </div>
  ${top.length?`<div class="pod">${top.map((r,i)=>`<div class="card"><div class="medal">${medals[i]}</div><div class="nm">${esc(r.d.name)}</div><div class="sc">${r.pts.total}</div><div class="mu">نقطة · ${r.orders} طلبية · ${r.days} يوم</div></div>`).join('')}</div>`:''}
  <div class="card tw"><table><thead><tr><th>الترتيب</th><th>المندوب</th><th>النقاط</th><th>أيام الحضور</th><th>فترات</th><th>غياب</th><th>إجازة/عذر</th><th>مرات التأخير</th><th>مجموع التأخير</th><th>ساعات العمل</th><th>الطلبيات</th><th>معدل/يوم</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr class="click" data-act="detail" data-d="${r.d.id}"><td><b>${i+1}</b></td><td><b>${esc(r.d.name)}</b> <span class="mu">${esc(r.d.code||'')}</span>${r.d.active===false?' <span class="chip c-m">موقوف</span>':''}${r.openOut?` <span class="chip c-a" title="تسجيلات بدون خروج — لا تُحسب ساعاتها">${r.openOut} بدون خروج</span>`:''}</td><td><b style="font-size:16px;color:${r.pts.total<0?'var(--red)':'var(--g2)'}">${r.pts.total}</b> <span class="mu" style="font-size:11px">(+${r.pts.plus} / ${r.pts.minus})</span></td>
  <td>${r.days}</td><td>${r.shifts}</td><td>${r.absent?`<b style="color:var(--red)">${r.absent}</b>`:0}</td><td>${r.leave}</td><td>${r.late?`<b style="color:var(--amb)">${r.late}</b>`:0}</td><td>${r.lateMin?dur(r.lateMin):'—'}</td><td>${r.hours.toFixed(1)}</td><td><b style="color:var(--gd)">${r.orders}</b></td><td>${r.avg.toFixed(1)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="mu" style="margin-top:8px;font-size:12px">الترتيب حسب مجموع النقاط. ${(P=>`كسب: طلبية +${P.order} · فترة حضور +${P.shift} · دخول في الوقت +${P.onTime} · أسبوع مكتمل +${P.weekOk} — خصم: تأخير −${P.late} · غياب بدون عذر −${P.absent} · خروج مبكر −${P.early} · أسبوع ناقص −${P.weekMiss}`)(cfg().points)}. التأخير والخروج المبكر بعد سماحية ${cfg().grace} دقائق. الأسابيع (السبت–الجمعة) تُحسب بعد انتهائها، وفترات الإجازة/العذر تُحتسب ضمن الحد الأسبوعي.</div>`;
}
/* ========== branded monthly report (print / save as PDF) ========== */
function reportHTML(m){
  const rows=monthStats(m),T=k=>rows.reduce((a,r)=>a+r[k],0),P=cfg().points,c=cfg();
  const top=rows.filter(r=>r.pts.total>0).slice(0,3),medals=['🥇','🥈','🥉'];
  const now=new Date();
  return `<div class="rp">
  <div class="rp-head"><img src="icons/icon-192.png" alt=""><div class="rp-co"><b>شركة سبيدي للتوصيل السريع</b><span>SPEEDY EXPRESS DELIVERY</span></div>
    <div class="rp-meta"><b>تقرير أداء المندوبين</b><span>${monthLabel(m)}</span></div></div>
  <div class="rp-kpis">
    <div><span>عدد المندوبين</span><b>${rows.length}</b></div><div><span>أيام الحضور</span><b>${T('days')}</b></div>
    <div><span>الغياب</span><b>${T('absent')}</b></div><div><span>مرات التأخير</span><b>${T('late')}</b></div>
    <div><span>ساعات العمل</span><b>${Math.round(T('hours'))}</b></div><div><span>الطلبيات المكتملة</span><b>${T('orders')}</b></div></div>
  ${top.length?`<div class="rp-sec">أفضل المندوبين</div><div class="rp-pod">${top.map((r,i)=>`<div><span class="md">${medals[i]}</span><b>${esc(r.d.name)}</b><span>${r.pts.total} نقطة · ${r.orders} طلبية · ${r.days} يوم</span></div>`).join('')}</div>`:''}
  <div class="rp-sec">الترتيب التفصيلي</div>
  <table class="rp-t"><thead><tr><th>#</th><th>المندوب</th><th>الرقم</th><th>النقاط</th><th>أيام</th><th>فترات</th><th>غياب</th><th>إجازة</th><th>تأخير</th><th>دقائق التأخير</th><th>خروج مبكر</th><th>ساعات</th><th>طلبيات</th><th>معدل/يوم</th></tr></thead><tbody>
  ${rows.map((r,i)=>`<tr><td>${i+1}</td><td class="nm">${esc(r.d.name)}${r.d.active===false?' <small>(موقوف)</small>':''}</td><td>${esc(r.d.code||'')}</td><td class="pt ${r.pts.total<0?'neg':''}">${r.pts.total}</td><td>${r.days}</td><td>${r.shifts}</td><td>${r.absent}</td><td>${r.leave}</td><td>${r.late}</td><td>${r.lateMin}</td><td>${r.early}</td><td>${r.hours.toFixed(1)}</td><td>${r.orders}</td><td>${r.avg.toFixed(1)}</td></tr>`).join('')}
  </tbody></table>
  <div class="rp-note"><b>نظام النقاط:</b> طلبية +${P.order} · فترة حضور +${P.shift} · دخول في الوقت +${P.onTime} · أسبوع مكتمل +${P.weekOk} — تأخير −${P.late} · غياب بدون عذر −${P.absent} · خروج مبكر −${P.early} · أسبوع ناقص −${P.weekMiss}. السماحية ${c.grace} دقائق، والحد الأسبوعي ${c.minShifts} فترات (السبت–الجمعة).</div>
  <div class="rp-sign"><div>المشرف<span></span></div><div>مدير العمليات<span></span></div><div>الاعتماد والختم<span></span></div></div>
  <div class="rp-foot"><span>سبيدي.. طلبيتك في إيدي</span><span>طرابلس — شارع الظل، بجانب مصحة الرازي · 0916268800 · speedy.com.ly</span><span>صدر في ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}</span></div>
  </div>`;
}
function printReport(){
  const el=$('#printArea');el.innerHTML=reportHTML(S.month);
  document.title=`تقرير المندوبين - ${monthLabel(S.month)} - سبيدي`;
  document.body.classList.add('printing');
  const done=()=>{document.body.classList.remove('printing');el.innerHTML='';document.title='سبيدي | تتبع المندوبين';removeEventListener('afterprint',done)};
  addEventListener('afterprint',done);
  const img=el.querySelector('img');const go=()=>setTimeout(()=>window.print(),50);
  if(img&&!img.complete){img.onload=go;img.onerror=go}else go();
}
function detail(id){
  const d=D.drivers[id];const R=recs().filter(r=>r.driverId===id&&monthOf(r.date)===S.month).sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift));
  const days=[...new Set([...R.map(r=>r.date),...Object.keys(D.orders).filter(ds=>monthOf(ds)===S.month&&ordersOf(ds,id)!=null)])].sort();
  const st=monthStats(S.month).find(r=>r.d.id===id)||{};
  $('#sheet').innerHTML=`<h3>${esc(d.name)} <span class="mu">${esc(d.code||'')}</span></h3><div class="mu">${monthLabel(S.month)}</div>
  <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
    <div class="card kpi" style="padding:10px"><div class="l">النقاط</div><div class="v" style="font-size:20px;color:var(--g2)">${st.pts?st.pts.total:0}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">غياب</div><div class="v" style="font-size:20px;color:var(--red)">${st.absent||0}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">تأخير</div><div class="v" style="font-size:20px;color:var(--amb)">${st.late||0}</div></div>
    <div class="card kpi" style="padding:10px"><div class="l">طلبيات</div><div class="v" style="font-size:20px;color:var(--gd)">${st.orders||0}</div></div>
  </div>
  ${st.pts?`<div class="card" style="margin-top:12px;padding:12px"><div class="sec" style="margin:0 0 6px">تفاصيل النقاط</div><table><tbody>${st.pts.items.filter(i=>i[1]&&i[2]).map(i=>`<tr><td>${i[0]}</td><td>${i[1]} × ${Math.abs(i[2])}</td><td style="text-align:left"><b style="color:${i[2]>0?'var(--g2)':'var(--red)'}">${i[2]>0?'+':'−'}${Math.abs(i[1]*i[2])}</b></td></tr>`).join('')||'<tr><td class="mu">لا توجد نقاط بعد</td></tr>'}<tr><td><b>المجموع</b></td><td></td><td style="text-align:left"><b style="font-size:17px">${st.pts.total}</b></td></tr></tbody></table></div>`:''}
  <div class="tw" style="margin-top:12px"><table><thead><tr><th>اليوم</th><th>الفترة</th><th>الحالة</th><th>دخول</th><th>خروج</th><th>تأخير</th><th>نقاط الفترة</th><th>طلبيات اليوم</th></tr></thead><tbody>
  ${days.map(ds=>{const rr=R.filter(r=>r.date===ds);const o=ordersOf(ds,id);
    if(!rr.length)return `<tr><td>${dayLabel(ds)}</td><td colspan="6" class="mu">—</td><td>${o??'—'}</td></tr>`;
    return rr.map((r,i)=>`<tr class="click" data-act="edit" data-id="${r.id}"><td>${i?'':dayLabel(ds)}</td><td>${SH[r.shift]}</td><td><span class="chip ${ST[r.status][1]}">${ST[r.status][0]}</span></td><td>${hm(r.checkIn)}</td><td>${hm(r.checkOut)}</td><td>${isLate(r)?`<span style="color:var(--amb)">${dur(r.lateMin)}</span>`:'—'}${isEarly(r)?` <span style="color:var(--amb)">خروج مبكر</span>`:''}</td><td>${(v=>`<b style="color:${v<0?'var(--red)':'var(--g2)'}">${v>0?'+':''}${v}</b>`)(dayPoints(r))}</td><td>${i?'':(o??'—')}</td></tr>`).join('')}).join('')||'<tr><td colspan="8" class="mu">لا توجد سجلات</td></tr>'}
  </tbody></table></div><div class="mfoot"><button class="btn" data-act="close">إغلاق</button></div>`;
  openModal();
}

/* ========== drivers ========== */
/* ========== shifts log (from the driver app) ========== */
function placeChip(d){const rad=(cfg().office||{}).radius||200;if(d==null)return '<span class="mu">—</span>';return d<=rad?'<span class="chip c-g">المكتب</span>':`<span class="chip c-a">على بعد ${fmtDist(d)}</span>`}
function vShifts(){
  const ds=S.date,R=recs().filter(r=>r.date===ds&&D.drivers[r.driverId]).sort((a,b)=>a.shift.localeCompare(b.shift)||(a.checkIn||0)-(b.checkIn||0));
  const P=R.filter(r=>r.status==='present'),open=P.filter(r=>!r.checkOut);
  const rows=R.map(r=>{const d=D.drivers[r.driverId];const st=r.status==='present'?(r.checkOut?'<span class="chip c-m">انتهت</span>':'<span class="chip c-g">جارية</span>'):`<span class="chip ${ST[r.status][1]}">${ST[r.status][0]}</span>`;
    return `<tr><td><b>${esc(d.name)}</b> <span class="mu">${esc(d.code||'')}</span></td><td>${SH[r.shift]}</td><td>${st}${isLate(r)?` <span class="chip c-a">متأخر ${dur(r.lateMin)}</span>`:''}${r.source&&r.source!=='app'?'':''}</td>
    <td>${hm(r.checkIn)}</td><td>${r.status==='present'?placeChip(r.inDist):'—'}</td><td>${hm(r.checkOut)}</td><td>${r.checkOut?placeChip(r.outDist):'—'}</td>
    <td>${r.checkIn&&r.checkOut?dur((r.checkOut-r.checkIn)/60000):r.checkIn?'<span class="mu">منذ '+dur((Date.now()-r.checkIn)/60000)+'</span>':'—'}</td>
    <td style="white-space:nowrap">${r.status==='present'?`<button class="btn sm" data-act="route" data-d="${esc(r.driverId)}" data-ds="${ds}">🗺️ المسار</button>`:''} ${isMgr()?`<button class="btn sm" data-act="edit" data-id="${esc(r.id)}">✎</button>`:''}</td></tr>`}).join('');
  /* monthly summary */
  const m=S.month,MR=recs().filter(r=>monthOf(r.date)===m&&D.drivers[r.driverId]);
  const ids=[...new Set(MR.map(r=>r.driverId))];
  const sum=ids.map(id=>{const p=MR.filter(r=>r.driverId===id&&r.status==='present');const hrs=p.reduce((a,r)=>a+(r.checkIn&&r.checkOut?(r.checkOut-r.checkIn)/3600000:0),0);
    return{d:D.drivers[id],days:new Set(p.map(r=>r.date)).size,shifts:p.length,hrs,late:p.filter(isLate).length,away:p.filter(r=>r.inDist!=null&&r.inDist>((cfg().office||{}).radius||200)).length,open:p.filter(r=>!r.checkOut).length}}).sort((a,b)=>b.hrs-a.hrs);
  return dateBar()+`<div class="grid k4" style="margin-bottom:12px">
    <div class="card kpi b"><div class="l">فترات بدأت</div><div class="v">${P.length}</div></div>
    <div class="card kpi g"><div class="l">جارية الآن</div><div class="v">${open.length}</div></div>
    <div class="card kpi"><div class="l">انتهت</div><div class="v">${P.length-open.length}</div></div>
    <div class="card kpi a"><div class="l">بدأت متأخرة</div><div class="v">${P.filter(isLate).length}</div></div></div>
  <div class="card tw">${R.length?`<table><thead><tr><th>المندوب</th><th>الفترة</th><th>الحالة</th><th>البداية</th><th>مكان البداية</th><th>النهاية</th><th>مكان النهاية</th><th>المدة</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty"><b>لا توجد فترات في ${dayLabel(ds)}</b>تظهر هنا الفترات التي يبدؤها المندوبون من التطبيق.</div>`}</div>
  <div class="tools" style="margin-top:18px"><div class="sec" style="margin:0">ملخص الشهر</div><select class="inp" id="monthPick">${monthOpts(m)}</select>${sum.length?'<button class="btn sm" data-act="shiftCsv">تنزيل Excel</button>':''}</div>
  <div class="card tw">${sum.length?`<table><thead><tr><th>المندوب</th><th>أيام العمل</th><th>الفترات</th><th>ساعات العمل</th><th>بدأ متأخراً</th><th>بدأ خارج المكتب</th><th>بدون إنهاء</th></tr></thead><tbody>
  ${sum.map(x=>`<tr><td><b>${esc(x.d.name)}</b> <span class="mu">${esc(x.d.code||'')}</span></td><td>${x.days}</td><td>${x.shifts}</td><td>${x.hrs.toFixed(1)}</td><td>${x.late?`<b style="color:var(--amb)">${x.late}</b>`:0}</td><td>${x.away?`<b style="color:var(--amb)">${x.away}</b>`:0}</td><td>${x.open?`<b style="color:var(--red)">${x.open}</b>`:0}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">لا توجد فترات في هذا الشهر.</div>'}</div>
  <div class="mu" style="margin-top:8px;font-size:12px">التأخر بعد سماحية ${cfg().grace} دقائق من بداية الفترة. «خارج المكتب» حسب نطاق المكتب في الإعدادات.</div>`;
}

function vDrivers(){

  const all=Object.values(D.drivers).sort((a,b)=>(a.active===false)-(b.active===false)||String(a.code||'').localeCompare(String(b.code||''),'en',{numeric:true}));
  if(!all.length)return emptyDrivers();
  return `<div class="tools"><button class="btn p" data-act="newDriver">+ إضافة مندوب</button><span class="mu">${all.filter(d=>d.active!==false).length} نشط · ${all.filter(d=>d.active===false).length} موقوف</span></div>
  <div class="card tw"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>الهاتف</th><th>الفترة المعتادة</th><th>الحالة</th><th>تطبيق المندوب</th><th></th></tr></thead><tbody>
  ${all.map(d=>`<tr><td>${esc(d.code||'')}</td><td><b>${esc(d.name)}</b></td><td dir="ltr" style="text-align:right">${esc(d.phone||'')}</td><td>${d.shift==='both'?'الفترتين':SH[d.shift]||'—'}</td><td>${d.active===false?`<span class="chip c-m">موقوف${d.stoppedAt?' منذ '+esc(d.stoppedAt):''}</span>`:'<span class="chip c-g">نشط</span>'}</td><td>${d.appLogin?`<span class="chip c-b" dir="ltr">📱 ${esc(d.appLogin)}</span>`:'<span class="mu">—</span>'} ${isMgr()?`<button class="btn sm" data-act="appAcc" data-d="${d.id}">${d.appLogin?'إدارة':'إنشاء حساب'}</button>`:''}</td><td><button class="btn sm" data-act="editDriver" data-d="${d.id}">تعديل</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function driverForm(d){
  const isNew=!d;
  if(isNew){const codes=Object.values(D.drivers).map(x=>parseInt(String(x.code||'').replace(/\D/g,''))||0);d={id:'d'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),code:'SP-'+String(Math.max(0,...codes)+1).padStart(3,'0'),name:'',phone:'',shift:'m',active:true,createdAt:todayStr()}}
  $('#sheet').innerHTML=`<h3>${isNew?'إضافة مندوب':'تعديل بيانات المندوب'}</h3><form id="drvForm"><div class="fg">
    <label>الاسم<input class="inp" name="name" required value="${esc(d.name)}"></label>
    <label>رقم المندوب<input class="inp" name="code" value="${esc(d.code)}"></label>
    <label>الهاتف<input class="inp" name="phone" dir="ltr" value="${esc(d.phone||'')}"></label>
    <label>الفترة المعتادة<select class="inp" name="shift"><option value="m" ${d.shift==='m'?'selected':''}>الصباحية</option><option value="e" ${d.shift==='e'?'selected':''}>المسائية</option><option value="both" ${d.shift==='both'?'selected':''}>الفترتين</option></select></label>
    <label class="full"><span class="row" style="gap:8px;color:var(--tx)"><input type="checkbox" name="active" ${d.active!==false?'checked':''} style="width:18px;height:18px;accent-color:var(--g)"> نشط (يظهر في الحضور)</span></label>
  </div><div class="mfoot"><button class="btn p" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button>${isNew||!isMgr()?'':`<button class="btn d" type="button" data-act="delDriver" data-d="${d.id}" style="margin-inline-start:auto">حذف</button>`}</div></form>`;
  $('#drvForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);
    const active=!!f.get('active');
    const n={...d,name:String(f.get('name')).trim(),code:String(f.get('code')).trim(),phone:String(f.get('phone')).trim(),shift:f.get('shift'),active,...stamp()};
    if(d.active!==false&&!active)n.stoppedAt=todayStr();
    if(active)n.stoppedAt=null;
    if(!n.name)return toast('أدخل الاسم');
    D.drivers[n.id]=n;closeModal();render();toast(isNew?'تمت الإضافة':'تم الحفظ');
    const{id,...data}=n;W(setDoc(doc(db,'drivers',id),data))};
  openModal();setTimeout(()=>{const x=$('#drvForm [name=name]');x&&x.focus()},50);
}

/* ========== settings & backup ========== */
function accountCard(){
  return `<div class="card"><div class="sec">الحساب والمزامنة</div><div class="mu" style="line-height:1.9;margin-bottom:12px">البيانات محفوظة على السحابة (Firebase) ومتزامنة بين الهاتف والكمبيوتر. بدون إنترنت يستمر البرنامج بالعمل ويرفع التسجيلات عند عودة الاتصال.<br>الحساب الحالي: <b style="color:var(--tx)" dir="ltr">${esc(myEmail())}</b> · <span class="chip ${isMgr()?'c-y':'c-g'}">${ROLE_LBL[role()]}</span></div>
    <div class="tools" style="margin:0"><button class="btn" data-act="logout">تسجيل الخروج</button><button class="btn" data-act="resetPw" data-e="${esc(myEmail())}">تغيير كلمة المرور</button></div></div>`;
}
function usersCard(){
  const owner=OWNER?[{e:OWNER,r:'owner'}]:[];
  const list=[...owner,...(ROLES.managers||[]).filter(e=>e!==OWNER).map(e=>({e,r:'manager'})),...(ROLES.supervisors||[]).filter(e=>e!==OWNER&&!(ROLES.managers||[]).includes(e)).map(e=>({e,r:'supervisor'}))];
  const lbl={owner:['صاحب المنصة','c-y'],manager:['مدير','c-y'],supervisor:['مشرف','c-g']};
  return `<div class="card"><div class="sec">المستخدمون والصلاحيات</div>
  <div class="mu" style="line-height:1.8;margin-bottom:10px"><b style="color:var(--tx)">المدير:</b> كل الأقسام، الإعدادات، حسابات تطبيق المندوب، تعديل الفترات وإدارة المستخدمين.<br><b style="color:var(--tx)">المشرف:</b> الخريطة المباشرة، المسارات، سجل الفترات، إضافة وتعديل المندوبين.</div>
  <table><tbody>${list.map(u=>`<tr><td dir="ltr" style="text-align:right">${esc(u.e)}</td><td><span class="chip ${lbl[u.r][1]}">${lbl[u.r][0]}</span></td><td style="text-align:left">${u.r==='owner'?'':`<button class="btn sm" data-act="roleSwap" data-e="${esc(u.e)}" data-r="${u.r==='manager'?'supervisors':'managers'}">${u.r==='manager'?'جعله مشرفاً':'جعله مديراً'}</button> <button class="btn sm d" data-act="userDel" data-e="${esc(u.e)}">إزالة</button>`}</td></tr>`).join('')}</tbody></table>
  <form id="userForm" class="fg"><label>البريد الإلكتروني<input class="inp" type="email" name="email" dir="ltr" required></label>
    <label>كلمة مرور مؤقتة (6 أحرف على الأقل)<input class="inp" type="text" name="pw" dir="ltr" minlength="6" placeholder="اتركها فارغة إن كان الحساب موجوداً"></label>
    <label>الصلاحية<select class="inp" name="role"><option value="supervisors">مشرف</option><option value="managers">مدير</option></select></label>
    <label style="justify-content:flex-end"><button class="btn p" type="submit">+ إضافة مستخدم</button></label></form>
  <div class="mu" style="font-size:12px;margin-top:8px">أرسل للمستخدم الرابط والبريد وكلمة المرور المؤقتة، ويمكنه تغييرها من «الحساب». الإزالة تلغي صلاحية الوصول فوراً.</div></div>`;
}
function officeCard(){
  const o=cfg().office||{};
  return `<form class="card" id="officeForm"><div class="sec">موقع المكتب (للتطبيق والتتبع)</div>
  <div class="mu" style="line-height:1.8">يُستخدم لمعرفة هل بدأ المندوب فترته من المكتب، ويظهر على خريطة التتبع. الأسهل: افتح هذه الصفحة على هاتفك وأنت في المكتب واضغط «موقعي الحالي».</div>
  <div class="fg"><label>خط العرض (Latitude)<input class="inp" name="lat" dir="ltr" inputmode="decimal" value="${o.lat??''}"></label><label>خط الطول (Longitude)<input class="inp" name="lng" dir="ltr" inputmode="decimal" value="${o.lng??''}"></label>
  <label>نطاق المكتب (متر)<input class="inp" name="radius" type="number" min="30" value="${o.radius||200}"></label><label style="justify-content:flex-end"><button class="btn" type="button" data-act="officeHere">📍 موقعي الحالي</button></label></div>
  <div class="mfoot"><button class="btn p" type="submit">حفظ</button></div></form>`;
}
function vSettings(){
  if(!isMgr())return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">${accountCard()}</div>`;
  const c=cfg();
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">
  <div class="grid" style="align-content:start">
  <form class="card" id="shiftForm"><div class="sec">مواعيد الفترات</div>
  <div class="mu" style="line-height:1.8">يقترح التطبيق على المندوب الفترة المناسبة حسب الوقت، ويوقف التتبع تلقائياً بعد ساعتين من نهاية الفترة إن نسي المندوب إنهاءها.</div>
  <div class="fg">
    <label>بداية الصباحية<input class="inp" type="time" name="ms" value="${c.shifts.m.start}"></label><label>نهاية الصباحية<input class="inp" type="time" name="me" value="${c.shifts.m.end}"></label>
    <label>بداية المسائية<input class="inp" type="time" name="es" value="${c.shifts.e.start}"></label><label>نهاية المسائية (يمكن بعد منتصف الليل)<input class="inp" type="time" name="ee" value="${c.shifts.e.end==='24:00'?'00:00':c.shifts.e.end}"></label>
    <label>سماحية التأخير (دقائق)<input class="inp" type="number" min="0" name="grace" value="${c.grace}"></label>
  </div><div class="mfoot"><button class="btn p" type="submit">حفظ</button></div></form>
  ${officeCard()}
  </div>
  <div class="grid" style="align-content:start">
  ${usersCard()}
  ${accountCard()}
  <div class="card"><div class="sec">النسخ الاحتياطي والاستيراد</div><div class="mu" style="margin-bottom:12px;line-height:1.9">• <b style="color:var(--tx)">تنزيل نسخة:</b> المندوبون وسجل الفترات والإعدادات (ملف JSON).<br>• <b style="color:var(--tx)">استيراد المندوبين:</b> اختر ملف نسخة احتياطية من منصة الحضور أو من هذه المنصة؛ تُضاف قائمة المندوبين فقط (الأسماء والأرقام والهواتف)، ولا يُحذف شيء.</div>
    <div class="tools"><button class="btn p" data-act="backup">تنزيل نسخة احتياطية</button><label class="btn" style="cursor:pointer">استيراد المندوبين<input type="file" id="restoreFile" accept=".json,application/json" hidden></label></div></div>
  </div></div>`;
}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function backup(){
  const att={};Object.values(D.att).forEach(r=>{att[r.id]={id:r.id,date:r.date,...cleanRec(r)}});
  download(`speedy-backup-${todayStr()}.json`,JSON.stringify({drivers:D.drivers,att,orders:D.orders,settings:D.settings,exportedAt:Date.now()}),'application/json');toast('تم تنزيل النسخة الاحتياطية');
}
function restore(file){const fr=new FileReader();fr.onload=()=>{let x;try{x=JSON.parse(fr.result)}catch(e){return toast('الملف غير صالح')}
  if(!x||!x.drivers)return toast('هذا ليس ملف نسخة احتياطية');
  const drv={};Object.values(x.drivers).forEach(d=>{if(d&&d.id)drv[d.id]={id:d.id,code:d.code||'',name:d.name||'',phone:d.phone||'',shift:d.shift||'m',active:d.active!==false,createdAt:d.createdAt||todayStr(),...(d.stoppedAt?{stoppedAt:d.stoppedAt}:{})}});
  confirmBox(`استيراد ${Object.keys(drv).length} مندوب؟ تُضاف الأسماء والأرقام والهواتف فقط، ولا يُحذف شيء.`,()=>importData({drivers:drv,att:{},orders:{},settings:null}))};fr.readAsText(file)}
async function importData(x){
  const ops=[];
  Object.values(x.drivers||{}).forEach(d=>{if(!d||!d.id)return;const{id,...data}=d;ops.push([doc(db,'drivers',String(id)),data,false])});
  const days={};
  Object.values(x.att||{}).forEach(r=>{if(!r||!r.date||!r.driverId||!r.shift)return;(days[r.date]=days[r.date]||{recs:{}}).recs[recKey(r)]=cleanRec(r)});
  Object.entries(x.orders||{}).forEach(([ds,o])=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(ds)||!o)return;const clean={};Object.entries(o).forEach(([k,v])=>{if(v!==''&&v!=null)clean[k]=Math.max(0,Math.round(num(v)))});(days[ds]=days[ds]||{recs:{}}).orders=clean});
  Object.entries(days).forEach(([ds,v])=>ops.push([dayRef(ds),v,true]));
  if(x.settings&&Object.keys(x.settings).length)ops.push([doc(db,'config','settings'),x.settings,true]);
  toast(`جاري الاستيراد… (${ops.length} عنصر)`);
  try{
    for(let i=0;i<ops.length;i+=400){const b=writeBatch(db);ops.slice(i,i+400).forEach(([ref,data,merge])=>merge?b.set(ref,data,{merge:true}):b.set(ref,data));await b.commit()}
    toast('تم الاستيراد ورفع البيانات ✓');
  }catch(e){console.error(e);toast('تعذر الاستيراد: '+(e.code||e.message))}
}

/* ========== user management (manager) ========== */
let secAuth=null;
function getSecAuth(){if(!secAuth){const a=initializeApp(firebaseConfig,'secondary');secAuth=initializeAuth(a,{persistence:inMemoryPersistence})}return secAuth}
async function addUser(email,pw,r){
  email=String(email||'').trim().toLowerCase();if(!email)return;
  if(email===OWNER)return toast('هذا حساب صاحب المنصة');
  let note='';
  if(pw){try{const sa=getSecAuth();await createUserWithEmailAndPassword(sa,email,pw);await signOut(sa);note='تم إنشاء الحساب'}
    catch(e){const c=e.code||'';
      if(c.includes('email-already-in-use'))note='الحساب موجود مسبقاً';
      else return toast(c.includes('weak-password')?'كلمة المرور ضعيفة (6 أحرف على الأقل)':c.includes('invalid-email')?'البريد غير صحيح':c.includes('network')?'إنشاء الحساب يحتاج إنترنت':'تعذر إنشاء الحساب: '+c)}}
  const other=r==='managers'?'supervisors':'managers';
  ROLES={...ROLES,[r]:[...new Set([...(ROLES[r]||[]),email])],[other]:(ROLES[other]||[]).filter(x=>x!==email)};render();
  await W(setDoc(doc(db,'config','roles'),{[r]:arrayUnion(email),[other]:arrayRemove(email)},{merge:true}));
  toast(`${note?note+' — ':''}أُضيف كـ${r==='managers'?'مدير':'مشرف'}`);syncStaff();
}
function removeUser(email){
  ROLES={managers:(ROLES.managers||[]).filter(x=>x!==email),supervisors:(ROLES.supervisors||[]).filter(x=>x!==email)};render();
  W(setDoc(doc(db,'config','roles'),{managers:arrayRemove(email),supervisors:arrayRemove(email)},{merge:true})).then(syncStaff);toast('أُزيلت الصلاحية');
}

/* ========== modal ========== */
function openModal(){$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden');$('#sheet').innerHTML=''}
function confirmBox(t,yes){$('#sheet').innerHTML=`<h3>تأكيد</h3><p style="margin-top:8px;line-height:1.8">${t}</p><div class="mfoot"><button class="btn d" id="yes">نعم</button><button class="btn" data-act="close">إلغاء</button></div>`;$('#yes').onclick=()=>{closeModal();yes()};openModal()}

/* ========== events ========== */
document.addEventListener('click',e=>{
  if(!started)return;
  const v=e.target.closest('[data-view]');if(v){S.view=v.dataset.view;closeModal();render();scrollTo(0,0);return}
  if(e.target.id==='modal')return closeModal();
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,id=b.dataset.d;
  if(a==='close')return closeModal();
  if(a==='summary')return showSummary();
  if(a==='sumCopy'){copyText($('#sumTxt').value).then(ok=>toast(ok?'تم نسخ الملخص ✓':'انسخ النص يدوياً'));return}
  if(a==='sumWa'){window.open('https://wa.me/?text='+encodeURIComponent($('#sumTxt').value),'_blank');return}
  if(a==='sumShare'){navigator.share({text:$('#sumTxt').value}).catch(()=>{});return}
  if(a==='allAlerts'){S.allAlerts=!S.allAlerts;return render()}
  if(a==='alert'){const k=b.dataset.k;
    if(k==='out'){const r=D.att[b.dataset.id];if(r){S.date=r.date;S.shift=r.shift;S.view='att';render();editRec(r.id)}return}
    if(k==='att'){S.date=b.dataset.ds;S.shift=b.dataset.sh;S.view='att';render();scrollTo(0,0);return}
    if(k==='ord'){S.date=b.dataset.ds;S.view='orders';render();scrollTo(0,0);return}}
  if(a==='pdf')return printReport();
  if(a==='route'){S.view='track';TS.mode='hist';TS.driver=id;TS.date=b.dataset.ds;closeModal();render();scrollTo(0,0);return}
  if(a==='shiftCsv'){const m=S.month,MR=recs().filter(r=>monthOf(r.date)===m&&D.drivers[r.driverId]).sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift));
    const rows=[['التاريخ','الفترة','الرقم','المندوب','الحالة','البداية','النهاية','المدة (ساعة)','متأخر (دقيقة)','بعد البداية عن المكتب (م)','بعد النهاية عن المكتب (م)']];
    MR.forEach(r=>{const d=D.drivers[r.driverId];rows.push([r.date,SH[r.shift],d.code||'',d.name,ST[r.status][0],hm(r.checkIn),hm(r.checkOut),r.checkIn&&r.checkOut?((r.checkOut-r.checkIn)/3600000).toFixed(2):'',isLate(r)?r.lateMin:0,r.inDist??'',r.outDist??''])});
    const csv='\ufeff'+rows.map(r=>r.map(c=>{c=String(c??'');return /[",\n]/.test(c)?`"${c.replace(/"/g,'""')}"`:c}).join(',')).join('\r\n');
    download(`speedy-shifts-${m}.csv`,csv,'text/csv;charset=utf-8');return toast('تم تنزيل الملف')}
  if(a==='tmode'){TS.mode=b.dataset.m;$('#trackRoot')&&$('#view').querySelectorAll('[data-act=tmode]').forEach(x=>x.classList.toggle('on',x.dataset.m===TS.mode));const h=$('#histTools');if(h)h.style.display=TS.mode==='hist'?'':'none';paintTrack(TS.mode==='live');if(TS.mode==='hist')loadHistory();else if(TRK){TRK.remove();TRK=null}return}
  if(a==='tfocus'){TS.focus=id;const m=MK[id];if(m&&MAP){MAP.flyTo(m.getLatLng(),16);m.openTooltip()}else toast('هذا المندوب ليس في الفترة حالياً');return paintTrack()}
  if(a==='appAcc'){if(!isMgr())return;return appAccountForm(id)}
  if(a==='appOff'){if(!isMgr())return;return confirmBox('إيقاف حساب التطبيق لهذا المندوب؟ لن يستطيع الدخول أو إرسال موقعه.',()=>disableAppAccount(id))}
  if(a==='waTo'){let ph=b.dataset.p||'';if(ph.startsWith('00'))ph=ph.slice(2);else if(ph.startsWith('0'))ph='218'+ph.slice(1);window.open(`https://wa.me/${ph}?text=`+encodeURIComponent($('#sumTxt').value),'_blank');return}
  if(a==='officeHere'){if(!navigator.geolocation)return toast('المتصفح لا يدعم تحديد الموقع');toast('جاري تحديد موقعك…');navigator.geolocation.getCurrentPosition(p=>{const f=$('#officeForm');f.lat.value=p.coords.latitude.toFixed(6);f.lng.value=p.coords.longitude.toFixed(6);toast(`تم — الدقة ${Math.round(p.coords.accuracy)} م. اضغط حفظ.`)},()=>toast('تعذر تحديد الموقع — اسمح للمتصفح بالوصول للموقع'),{enableHighAccuracy:true,timeout:20000});return}
  if(a==='resetPw'){const e=b.dataset.e;return confirmBox(`إرسال رابط تغيير كلمة المرور إلى <b dir="ltr">${esc(e)}</b>؟`,()=>sendPasswordResetEmail(auth,e).then(()=>toast('أُرسل الرابط إلى البريد (تحقق من الرسائل غير المرغوبة)')).catch(err=>toast('تعذر الإرسال: '+(err.code||''))))}
  if(a==='roleSwap'){if(!isMgr())return;const e=b.dataset.e;return addUser(e,'',b.dataset.r)}
  if(a==='userDel'){if(!isMgr())return;const e=b.dataset.e;return confirmBox(`إزالة صلاحية <b dir="ltr">${esc(e)}</b>؟ لن يستطيع الدخول إلى البيانات.`,()=>removeUser(e))}
  if(a==='logout')return confirmBox('تسجيل الخروج من هذا الجهاز؟',()=>signOut(auth));
  if(a==='shift'){S.shift=b.dataset.s;return render()}
  if(a==='day'){S.date=addDays(S.date,+b.dataset.n);return render()}
  if(a==='today'){Object.assign(S,defaultDateShift());return render()}
  if(a==='in'){const ex=getRec(S.date,S.shift,id),r=ex?{...ex}:newRec(id,'present');r.status='present';const bd=bounds(S.date,S.shift);
    if(Date.now()>bd.start-3*3600000&&Date.now()<bd.end+3*3600000){r.checkIn=Date.now();r.checkOut=null;saveRec(r);toast(`دخول ${D.drivers[id].name} — ${hm(r.checkIn)}`)}
    else{r.checkIn=bd.start;r.checkOut=null;saveRec(r);editRec(r.id);toast('يوم سابق: اكتب الوقت الفعلي')}return}
  if(a==='out'){const r={...getRec(S.date,S.shift,id)},bd=bounds(S.date,S.shift);
    if(Date.now()-bd.start<20*3600000&&Date.now()>r.checkIn){r.checkOut=Date.now();saveRec(r);toast(`خروج ${D.drivers[id].name} — ${hm(r.checkOut)}`)}
    else{r.checkOut=bd.end;saveRec(r);editRec(r.id);toast('يوم سابق: عدّل وقت الخروج الفعلي')}return}
  if(a==='absent'||a==='leave'){saveRec(newRec(id,a));return toast(a==='absent'?'تم تسجيل غياب':'تم تسجيل إجازة')}
  if(a==='absentRest'){const L=activeDrivers().filter(d=>(d.shift===S.shift||d.shift==='both')&&!getRec(S.date,S.shift,d.id));
    return confirmBox(`تسجيل غياب لـ ${L.length} مندوب لم يسجلوا في الفترة ${SH[S.shift]}:<br><span class="mu">${L.map(d=>esc(d.name)).join('، ')}</span>`,()=>{
      const map={};L.forEach(d=>{const r=derive({...newRec(d.id,'absent'),...stamp()});D.att[r.id]=r;map[recKey(r)]=cleanRec(r)});
      render();W(setDoc(dayRef(S.date),{recs:map},{merge:true}));toast('تم تسجيل الغياب')})}
  if(a==='edit')return editRec(b.dataset.id);
  if(a==='delRec')return confirmBox('حذف هذا التسجيل؟',()=>delRec(b.dataset.id));
  if(a==='newDriver')return driverForm();
  if(a==='editDriver')return driverForm(D.drivers[id]);
  if(a==='delDriver'){if(!isMgr())return;const has=recs().some(r=>r.driverId===id);return confirmBox(has?'لهذا المندوب تسجيلات سابقة، والأفضل إيقافه (إلغاء علامة نشط) حتى تبقى التقارير صحيحة. حذفه نهائياً؟':'حذف المندوب نهائياً؟',()=>{delete D.drivers[id];render();W(deleteDoc(doc(db,'drivers',id)))})}
  if(a==='detail'){if(!isMgr())return;return detail(id)}
  if(a==='backup')return backup();
  if(a==='print')return window.print();
  if(a==='csv'){const rows=[['الترتيب','الرقم','المندوب','النقاط','نقاط مكتسبة','نقاط مخصومة','أيام الحضور','فترات','غياب','إجازة/عذر','مرات التأخير','مجموع التأخير (دقيقة)','ساعات العمل','الطلبيات المكتملة','معدل الطلبيات/يوم']];
    monthStats(S.month).forEach((r,i)=>rows.push([i+1,r.d.code,r.d.name,r.pts.total,r.pts.plus,r.pts.minus,r.days,r.shifts,r.absent,r.leave,r.late,r.lateMin,r.hours.toFixed(1),r.orders,r.avg.toFixed(1)]));
    const csv='﻿'+rows.map(r=>r.map(c=>{c=String(c??'');return /[",\n]/.test(c)?`"${c.replace(/"/g,'""')}"`:c}).join(',')).join('\r\n');
    download(`speedy-mandoubin-${S.month}.csv`,csv,'text/csv;charset=utf-8');return toast('تم تنزيل الملف')}
});
document.addEventListener('input',e=>{
  if(e.target.id==='q'){S.q=e.target.value;render()}
  if(e.target.classList.contains('ord')){const ins=[...document.querySelectorAll('.ord')];$('#ordTotal').textContent=ins.reduce((a,i)=>a+num(i.value),0);$('#ordFilled').textContent=`${ins.filter(i=>i.value!=='').length}/${ins.length}`}
});
document.addEventListener('focusout',e=>{
  if(e.target.classList&&e.target.classList.contains('ord'))setTimeout(()=>{const a=document.activeElement;if(pendingRender&&!(a&&a.classList&&a.classList.contains('ord'))){pendingRender=false;render()}},0);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if(e.key==='Enter'&&e.target.classList.contains('ord')){e.preventDefault();const ins=[...document.querySelectorAll('.ord')];const n=ins[ins.indexOf(e.target)+1];if(n){n.focus();n.select()}else{e.target.blur();toast('تم حفظ طلبيات اليوم ✓')}}
});
document.addEventListener('change',e=>{
  if(e.target.classList.contains('ord')){setOrder(S.date,e.target.dataset.d,e.target.value);return}
  if(e.target.id==='datePick'&&e.target.value){S.date=e.target.value;render()}
  if(e.target.id==='monthPick'){S.month=e.target.value;render()}
  if(e.target.id==='tDate'&&e.target.value){TS.date=e.target.value;loadHistory()}
  if(e.target.id==='tDriver'){TS.driver=e.target.value;loadHistory()}
  if(e.target.id==='restoreFile'&&e.target.files[0]&&isMgr()){restore(e.target.files[0]);e.target.value=''}
});
document.addEventListener('submit',e=>{
  if(e.target.id==='appForm'){e.preventDefault();if(!isMgr())return;const f=new FormData(e.target),btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
    createAppAccount(e.target.dataset.d,f.get('login'),String(f.get('pw'))).finally(()=>{btn.disabled=false});return}
  if(e.target.id==='officeForm'){e.preventDefault();if(!isMgr())return;const f=new FormData(e.target);const lat=parseFloat(f.get('lat')),lng=parseFloat(f.get('lng')),radius=Math.max(30,Math.round(num(f.get('radius'))||200));
    const office=isFinite(lat)&&isFinite(lng)?{lat,lng,radius}:null;D.settings={...D.settings,office};drawOffice();render();toast(office?'تم حفظ موقع المكتب':'أُزيل موقع المكتب');
    W(setDoc(doc(db,'config','settings'),{office,...stamp()},{merge:true}));return}
  if(e.target.id==='shiftForm'){e.preventDefault();if(!isMgr())return;const f=new FormData(e.target);
    const sh={m:{start:f.get('ms'),end:f.get('me')},e:{start:f.get('es'),end:f.get('ee')==='00:00'?'24:00':f.get('ee')}};
    if(toMin(sh.m.end)<=toMin(sh.m.start))return toast('نهاية الصباحية يجب أن تكون بعد بدايتها');
    const grace=Math.max(0,num(f.get('grace')));D.settings={...D.settings,shifts:sh,grace};Object.values(D.att).forEach(derive);render();toast('تم حفظ الإعدادات');
    W(setDoc(doc(db,'config','settings'),{shifts:sh,grace,...stamp()},{merge:true}));return}
  if(e.target.id==='userForm'){e.preventDefault();if(!isMgr())return;const f=new FormData(e.target),btn=e.target.querySelector('button');btn.disabled=true;
    addUser(f.get('email'),String(f.get('pw')||''),f.get('role')).finally(()=>{btn.disabled=false});return}
  if(e.target.id==='setForm'){e.preventDefault();if(!isMgr())return toast('تغيير الإعدادات للمدير فقط');const f=new FormData(e.target);
    const s={shifts:{m:{start:f.get('ms'),end:f.get('me')},e:{start:f.get('es'),end:f.get('ee')==='00:00'?'24:00':f.get('ee')}},grace:Math.max(0,num(f.get('grace'))),minShifts:Math.max(0,num(f.get('minShifts'))),
      points:Object.fromEntries(Object.keys(DEFAULTS.points).map(k=>[k,Math.max(0,num(f.get('p_'+k)))]))};
    if(toMin(s.shifts.m.end)<=toMin(s.shifts.m.start))return toast('نهاية الصباحية يجب أن تكون بعد بدايتها');
    D.settings={...s,office:(D.settings||{}).office||null};Object.values(D.att).forEach(derive);render();toast('تم حفظ الإعدادات');
    W(setDoc(doc(db,'config','settings'),{...s,...stamp()},{merge:true}));}
});

/* ========== auth & live sync ========== */
function showLogin(msg=''){
  started=false;$('#app').classList.add('hidden');$('#botNav').classList.add('hidden');closeModal();gate.classList.remove('hidden');
  gate.innerHTML=gateHTML(`<form id="loginForm"><input class="inp" type="email" name="email" placeholder="البريد الإلكتروني" dir="ltr" autocomplete="username" required>
    <input class="inp" type="password" name="pw" placeholder="كلمة المرور" dir="ltr" autocomplete="current-password" required>
    <div class="err" id="lerr">${esc(msg)}</div><button class="btn p" type="submit">دخول</button></form>`);
  $('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),btn=e.target.querySelector('button');btn.disabled=true;$('#lerr').textContent='';
    try{await signInWithEmailAndPassword(auth,String(f.get('email')).trim(),String(f.get('pw')))}
    catch(err){const c=err.code||'';$('#lerr').textContent=c.includes('network')?'لا يوجد اتصال بالإنترنت — أول دخول يحتاج إنترنت':c.includes('too-many')?'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة':'البريد أو كلمة المرور غير صحيحة';btn.disabled=false}};
}
function showLoading(){gate.classList.remove('hidden');gate.innerHTML=gateHTML('<div class="spin"></div><div class="mu">جاري تحميل البيانات…</div>')}
function startApp(){
  if(started)return;started=true;
  Object.assign(S,defaultDateShift());
  gate.classList.add('hidden');$('#app').classList.remove('hidden');$('#botNav').classList.remove('hidden');
  $('#who').textContent=user.email||'';render();
}
function changed(){updateSync();if(!started){if(ready.drivers&&ready.days&&ready.settings&&ready.roles)startApp();return}scheduleRender()}
function listenErr(err){
  console.error(err);
  if(err&&err.code==='permission-denied'){unsubs.forEach(f=>f());unsubs=[];
    gate.classList.remove('hidden');$('#app').classList.add('hidden');$('#botNav').classList.add('hidden');started=false;
    gate.innerHTML=gateHTML(`<div class="card" style="margin-top:18px;line-height:1.9">⛔ الحساب <b dir="ltr">${esc(user&&user.email)}</b> غير مصرّح له بالوصول للبيانات.<br><span class="mu">أضف هذا البريد في قواعد Firestore (firestore.rules).</span></div><button class="btn" style="margin-top:12px" id="lo">تسجيل الخروج</button>`);
    $('#lo').onclick=()=>signOut(auth);
  }else toast('خطأ في الاتصال بقاعدة البيانات');
}
function subscribe(){
  ready={drivers:false,days:false,settings:false,roles:false};pending={};ROLES={managers:[],supervisors:[]};
  unsubs.push(onSnapshot(doc(db,'config','roles'),s=>{
    const v=s.exists()?s.data():{};const L=x=>(Array.isArray(x)?x:[]).map(e=>String(e).toLowerCase());
    ROLES={managers:L(v.managers),supervisors:L(v.supervisors)};ready.roles=true;changed()},listenErr));
  let from=monthOf(todayStr());for(let i=0;i<12;i++)from=prevMonth(from);from=addDays(from+'-01',-7);
  unsubs.push(onSnapshot(collection(db,'drivers'),{includeMetadataChanges:true},s=>{
    const o={};s.forEach(x=>o[x.id]={...x.data(),id:x.id});D.drivers=o;pending.drivers=s.metadata.hasPendingWrites;ready.drivers=true;changed()},listenErr));
  unsubs.push(onSnapshot(query(collection(db,'days'),where(documentId(),'>=',from)),{includeMetadataChanges:true},s=>{
    const att={},orders={};
    s.forEach(x=>{const ds=x.id,v=x.data()||{};
      Object.values(v.recs||{}).forEach(r=>{if(!r||!r.driverId||!r.shift)return;const id=recId(ds,r.shift,r.driverId);att[id]=derive({...r,id,date:ds})});
      if(v.orders)orders[ds]={...v.orders}});
    D.att=att;D.orders=orders;pending.days=s.metadata.hasPendingWrites;ready.days=true;changed()},listenErr));
  unsubs.push(onSnapshot(doc(db,'config','settings'),{includeMetadataChanges:true},s=>{
    D.settings=s.exists()?s.data():{};Object.values(D.att).forEach(derive);try{drawOffice()}catch(e){}pending.settings=s.metadata.hasPendingWrites;ready.settings=true;changed()},listenErr));
}
onAuthStateChanged(auth,u=>{
  unsubs.forEach(f=>f());unsubs=[];
  if(!u){user=null;D={drivers:{},att:{},orders:{},settings:{}};showLogin();return}
  user=u;started=false;ROLES={managers:[],supervisors:[]};showLoading();subscribe();
});
tick();setInterval(()=>{tick();if(started&&S.view==='track'&&TS.mode==='live')paintTrack()},30000);
