/**
 * AuthModal.jsx — Real Firebase Authentication Modal
 * ════════════════════════════════════════════════════
 * Supports:
 *   • Register (Email + Password)
 *   • Sign In  (Email + Password)
 *   • Continue with Google
 *
 * On success the useAuth hook automatically picks up the auth state
 * change and calls the backend /api/auth/firebase-verify endpoint.
 */

import React, { useState } from 'react';
import { X, Mail, Lock, User, Sparkles, LogIn, UserPlus, AlertCircle, CheckCircle } from 'lucide-react';
import {
  auth,
  googleProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from '../utils/firebase';

const GRAPE_VARIETIES = [
  'Thompson Seedless',
  'Manik Chaman',
  'Sharad Seedless',
  'Flame Seedless',
  'Bangalore Blue',
  'Italia',
  'Sonaka',
];

export default function AuthModal({ isOpen, onClose }) {
  const [mode, setMode]             = useState('login'); // 'login' | 'register'
  const [name, setName]             = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [variety, setVariety]       = useState('Thompson Seedless');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');

  if (!isOpen) return null;

  const clearForm = () => {
    setError('');
    setSuccess('');
  };

  const handleClose = () => {
    clearForm();
    setMode('login');
    setName('');
    setEmail('');
    setPassword('');
    onClose();
  };

  // ── Email / Password Register ─────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Set display name so Header shows it
      await updateProfile(cred.user, { displayName: name || email.split('@')[0] });
      setSuccess('Account created! Welcome to Grape Master 🍇');
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ── Email / Password Sign In ──────────────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setSuccess('Welcome back! 🍇');
      setTimeout(handleClose, 1000);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ── Google Sign In ────────────────────────────────────────────
  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      setSuccess('Signed in with Google! 🍇');
      setTimeout(handleClose, 1000);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="glass-card w-full max-w-md rounded-2xl p-6 border border-emerald-500/40 relative shadow-2xl">

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-xl">
            🍇
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              {mode === 'login' ? 'Sign In to Grape Master' : 'Create Your Farmer Account'}
            </h3>
            <p className="text-xs text-slate-400">
              {mode === 'login' ? 'Access your diagnosis history & advisory' : 'Save history, get personalized advice'}
            </p>
          </div>
        </div>

        {/* Success State */}
        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold mb-4 animate-fadeIn">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs mb-4 animate-fadeIn">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={mode === 'register' ? handleRegister : handleSignIn} className="space-y-3">
          
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
              <div className="flex items-center bg-slate-900 border border-slate-700 focus-within:border-emerald-500/60 rounded-xl px-3 py-2.5 transition-colors">
                <User className="w-4 h-4 text-slate-500 mr-2 flex-shrink-0" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rajendra Patil"
                  className="bg-transparent text-white text-sm focus:outline-none flex-1 placeholder-slate-500"
                  required={mode === 'register'}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
            <div className="flex items-center bg-slate-900 border border-slate-700 focus-within:border-emerald-500/60 rounded-xl px-3 py-2.5 transition-colors">
              <Mail className="w-4 h-4 text-slate-500 mr-2 flex-shrink-0" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="farmer@example.com"
                className="bg-transparent text-white text-sm focus:outline-none flex-1 placeholder-slate-500"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
            <div className="flex items-center bg-slate-900 border border-slate-700 focus-within:border-emerald-500/60 rounded-xl px-3 py-2.5 transition-colors">
              <Lock className="w-4 h-4 text-slate-500 mr-2 flex-shrink-0" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Min. 6 characters' : '••••••••'}
                className="bg-transparent text-white text-sm focus:outline-none flex-1 placeholder-slate-500"
                required
                minLength={6}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Primary Grape Variety</label>
              <select
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none transition-colors"
              >
                {GRAPE_VARIETIES.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-950/40 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-1"
          >
            {loading ? (
              <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
            ) : mode === 'register' ? (
              <><UserPlus className="w-4 h-4" /> Create Account</>
            ) : (
              <><LogIn className="w-4 h-4" /> Sign In</>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-slate-500 text-xs font-medium">or</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-slate-700 hover:border-slate-600 text-white text-sm font-semibold transition-all disabled:opacity-50"
        >
          {/* Google G icon */}
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Mode Toggle */}
        <p className="text-center text-xs text-slate-400 mt-4">
          {mode === 'login' ? (
            <>Don&apos;t have an account?{' '}
              <button
                onClick={() => { setMode('register'); clearForm(); }}
                className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
              >
                Register here
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button
                onClick={() => { setMode('login'); clearForm(); }}
                className="text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
              >
                Sign in
              </button>
            </>
          )}
        </p>

      </div>
    </div>
  );
}

// Map Firebase error codes to user-friendly messages
function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email. Please register first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Incorrect email or password. Please try again.',
    'auth/too-many-requests': 'Too many failed attempts. Please wait a moment.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
  };
  return map[code] || `Sign-in error: ${code}`;
}
