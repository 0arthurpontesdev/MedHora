import {getMessaging,getToken,isSupported,onMessage} from 'firebase/messaging';
import {firebaseApp} from './firebase.js';

// Chave pública VAPID do projeto Firebase (não é segredo).
const VAPID_KEY='BOtrzXcz-o9ch5OsPAW4Oi9VZ4w5Nt5bzwv3flytAba1PmUNJc9wLthrL8h4A74cDUUN3y2z1mdhZiMtmTpMFNs';

export async function activatePushNotifications() {
  if(!('serviceWorker'in navigator)||!await isSupported())throw new Error('Este navegador não oferece notificações em segundo plano.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('Autorize as notificações nas configurações do navegador.');
  if(!VAPID_KEY)throw new Error('A chave de notificações ainda não foi configurada.');
  const registration=await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token=await getToken(getMessaging(firebaseApp),{vapidKey:VAPID_KEY,serviceWorkerRegistration:registration});
  if(!token)throw new Error('O aparelho não forneceu um identificador de notificação.');
  return token;
}

export function listenForForegroundMessages(onNotification) {
  let unsubscribe=()=>{};let active=true;
  isSupported().then(supported=>{if(active&&supported)unsubscribe=onMessage(getMessaging(firebaseApp),onNotification);}).catch(()=>{});
  return()=>{active=false;unsubscribe();};
}
