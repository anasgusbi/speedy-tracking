/* Service worker: يجعل البرنامج يفتح بدون إنترنت ويثبت كتطبيق على الهاتف */
const CACHE='speedy-trk-v1';
const SHELL=['./','./index.html','./js/app.js','./js/firebase-config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  // ملفات البرنامج نفسه: الشبكة أولاً (حتى تصل التحديثات)، والنسخة المخزنة عند انقطاع الإنترنت
  if(url.origin===self.location.origin){
    e.respondWith(fetch(req).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return res})
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
    return;
  }
  // مكتبة Firebase والخطوط: من التخزين أولاً
  if(url.host==='www.gstatic.com'||url.host==='unpkg.com'||url.host==='fonts.googleapis.com'||url.host==='fonts.gstatic.com'){
    e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{if(res.ok||res.type==='opaque'){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return res})));
  }
  // أي طلب آخر (Firestore / تسجيل الدخول) يمر مباشرة بدون تدخل
});
