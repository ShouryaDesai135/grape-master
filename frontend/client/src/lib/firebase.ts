/**
 * firebase.ts — Frontend Firebase Auth Setup
 * ════════════════════════════════════════════════════════════
 * Initializes Firebase Client SDK for Google Sign-In and Email/Password authentication.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  User
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSy_DEMO_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "grape-master-demo.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "grape-master-demo",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "grape-master-demo.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:demo"
};

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Sign in with Google Popup
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    return { user: result.user, idToken };
  } catch (error: any) {
    console.error("Google Sign-In Error:", error);
    throw error;
  }
}

/**
 * Sign in with Email and Password
 */
export async function signInWithEmail(email: string, pass: string) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    const idToken = await result.user.getIdToken();
    return { user: result.user, idToken };
  } catch (error: any) {
    console.error("Email Sign-In Error:", error);
    throw error;
  }
}

/**
 * Register with Email and Password
 */
export async function signUpWithEmail(email: string, pass: string) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    const idToken = await result.user.getIdToken();
    return { user: result.user, idToken };
  } catch (error: any) {
    console.error("Sign-Up Error:", error);
    throw error;
  }
}

/**
 * Sign Out
 */
export async function signOutUser() {
  await firebaseSignOut(auth);
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
