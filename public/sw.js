const CACHE="alfashare-v300";
const SHELL=["/","/index.html","/css/style.css","/js/app.js","/manifest.json","/icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const u=new URL(e.request.url);
 if(u.pathname.startsWith("/socket.io/")||u.pathname.startsWith("/api/"))return;
 e.respondWith(caches.match(e.request).then(cached=>{
   const network=fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>cached||caches.match("/index.html"));
   return cached||network;
 }));
});
