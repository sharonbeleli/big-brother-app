const C='bb-v6';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','safety.js','manifest.json','icon.svg','memory.js','engine.js','ai.js','auth.js','supabase.js','content/cases.json','content/flows.json']))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));
