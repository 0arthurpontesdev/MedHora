import {getApps, initializeApp} from 'firebase/app';
import {initializeAppCheck, ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import {getAuth, GoogleAuthProvider} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'minha-medicacao-arthur-2026',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1035829086735:web:a4f0bda1c3eebe7228b17a',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'minha-medicacao-arthur-2026.firebasestorage.app',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAtGmFQVCNU3oK1zN-4a81Y0lVaT5vUEbw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'minha-medicacao-arthur-2026.web.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1035829086735',
};

export const firebaseApp = initializeApp(firebaseConfig);
const appCheckSiteKey=import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
if(typeof window!=='undefined'&&appCheckSiteKey){
  initializeAppCheck(firebaseApp,{
    provider:new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled:true,
  });
}
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt:'select_account'});
export const db = getFirestore(firebaseApp);

// A M.A.R.I.A. usa um projeto Firebase separado. Assim, autenticação, agenda,
// histórico e hospedagem continuam no projeto principal, enquanto apenas as
// chamadas de IA usam cotas e faturamento próprios.
const mariaFirebaseConfig = {
  projectId: import.meta.env.VITE_MARIA_FIREBASE_PROJECT_ID || 'medhora-maria-arthur-2026',
  appId: import.meta.env.VITE_MARIA_FIREBASE_APP_ID || '1:1078470936269:web:09dc32fb39279db86d4b84',
  storageBucket: import.meta.env.VITE_MARIA_FIREBASE_STORAGE_BUCKET || 'medhora-maria-arthur-2026.firebasestorage.app',
  apiKey: import.meta.env.VITE_MARIA_FIREBASE_API_KEY || 'AIzaSyCzSFAITtEmJEbCiW43r2P0kbTk2EKDz4I',
  authDomain: import.meta.env.VITE_MARIA_FIREBASE_AUTH_DOMAIN || 'medhora-maria-arthur-2026.firebaseapp.com',
  messagingSenderId: import.meta.env.VITE_MARIA_FIREBASE_MESSAGING_SENDER_ID || '1078470936269',
};

const MARIA_APP_NAME = 'medhora-maria';
export const mariaFirebaseApp = getApps().find((app) => app.name === MARIA_APP_NAME)
  || initializeApp(mariaFirebaseConfig, MARIA_APP_NAME);

const mariaAppCheckSiteKey = import.meta.env.VITE_MARIA_FIREBASE_APP_CHECK_SITE_KEY;
if (typeof window !== 'undefined' && mariaAppCheckSiteKey) {
  initializeAppCheck(mariaFirebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(mariaAppCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
