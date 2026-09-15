import {initializeApp} from 'firebase/app';
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
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt:'select_account'});
export const db = getFirestore(firebaseApp);
