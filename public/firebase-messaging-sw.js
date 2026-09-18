importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId:'minha-medicacao-arthur-2026',
  appId:'1:1035829086735:web:a4f0bda1c3eebe7228b17a',
  apiKey:'AIzaSyAtGmFQVCNU3oK1zN-4a81Y0lVaT5vUEbw',
  authDomain:'minha-medicacao-arthur-2026.web.app',
  messagingSenderId:'1035829086735',
});

// O SDK exibe a notificação enviada pelo FCM e abre o link configurado.
firebase.messaging();

const APP_CACHE='medhora-app-v1';
const APP_SHELL=['/','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(APP_CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('medhora-app-')&&key!==APP_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(APP_CACHE).then(cache=>cache.put('/',copy));return response;}).catch(()=>caches.match('/')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok)caches.open(APP_CACHE).then(cache=>cache.put(request,response.clone()));return response;})));
});
