import {initializeApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';

const firebaseConfig = {
  projectId: 'minha-medicacao-arthur-2026',
  appId: '1:1035829086735:web:a4f0bda1c3eebe7228b17a',
  storageBucket: 'minha-medicacao-arthur-2026.firebasestorage.app',
  apiKey: 'AIzaSyAtGmFQVCNU3oK1zN-4a81Y0lVaT5vUEbw',
  authDomain: 'minha-medicacao-arthur-2026.web.app',
  messagingSenderId: '1035829086735',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt:'select_account'});
export const db = getFirestore(firebaseApp);
