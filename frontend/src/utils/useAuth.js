/**
 * useAuth.js — Firebase Auth State Hook
 * ══════════════════════════════════════
 * Listens to Firebase auth state changes, calls the backend
 * firebase-verify endpoint to exchange the Firebase ID token
 * for our own JWT, and exposes user + loading state globally.
 */

import { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, signOut, auth } from './firebase';
import { verifyFirebaseToken, clearJWT } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase user
  const [backendUser, setBackendUser]   = useState(null); // backend farmer record
  const [loading, setLoading]           = useState(true);
  const [authError, setAuthError]       = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthError(null);

      if (user) {
        setFirebaseUser(user);
        try {
          // Get the Firebase ID token and verify with our backend
          const idToken = await user.getIdToken();
          const result  = await verifyFirebaseToken(idToken, 'en');
          if (result.success) {
            setBackendUser(result.farmer || result.user || null);
          }
        } catch (err) {
          console.error('Backend verify error:', err);
          setAuthError(err.message);
        }
      } else {
        // Signed out
        setFirebaseUser(null);
        setBackendUser(null);
        clearJWT();
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    await signOut(auth);
    clearJWT();
    setFirebaseUser(null);
    setBackendUser(null);
  };

  const value = {
    firebaseUser,
    backendUser,
    loading,
    authError,
    isLoggedIn: !!firebaseUser,
    logout,
    // Helper: display name from Firebase profile
    displayName: firebaseUser?.displayName || firebaseUser?.email?.split('@')[0] || 'Farmer',
    photoURL: firebaseUser?.photoURL || null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
