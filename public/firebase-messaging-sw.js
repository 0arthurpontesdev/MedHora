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
