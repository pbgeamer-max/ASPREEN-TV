import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDj8X3FiAsTwwIL6PV9k3p4X8lrJv3YdIg',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'aspreen-tv.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'aspreen-tv',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'aspreen-tv.firebasestorage.app',
};

let app: FirebaseApp;
let auth: Auth | null = null;

export function getClientFirebaseApp(): FirebaseApp {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  return app;
}

export function getClientAuth(): Auth | null {
  if (typeof window === 'undefined') return null;
  if (!auth) {
    try {
      const app = getClientFirebaseApp();
      auth = getAuth(app);
    } catch {
      auth = null;
    }
  }
  return auth;
}
