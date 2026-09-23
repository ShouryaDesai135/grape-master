/**
 * Header.jsx — App Header with Real Auth State
 * ════════════════════════════════════════════════
 * Shows the logged-in user's name/avatar when authenticated,
 * or a "Sign In" button when not authenticated.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Globe, LayoutDashboard, MessageSquare, LogOut, ChevronDown, User } from 'lucide-react';
import { translations } from '../utils/translations';
import { useAuth } from '../utils/useAuth';

export default function Header({ currentLang, setLang, activeTab, setActiveTab, onOpenAuth }) {
  const t = translations[currentLang];
  const { isLoggedIn, displayName, photoURL, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setShowDropdown(false);
    await logout();
  };

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80 px-4 lg:px-8 py-3.5 shadow-2xl transition-all duration-300">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">

        {/* Brand Logo & Live Engine Status */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setActiveTab('chat')}>
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-600 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-emerald-950/60 group-hover:scale-105 transition-transform duration-300">
              🍇
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight gradient-text-emerald">
                  {t.appName}
                </h1>
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold tracking-wide">
                  <Sparkles className="w-3 h-3 text-emerald-400 animate-pulse" /> AI 3.0 PRO
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium leading-none mt-0.5">
                {t.tagline}
              </p>
            </div>
          </div>

          {/* Engine Active Badge */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-emerald-500/30 text-xs text-emerald-300 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse glow-emerald"></span>
            <span className="font-semibold text-[11px] tracking-wide">{t.activeStatus}</span>
          </div>
        </div>

        {/* Center: Tab Switcher */}
        <div className="flex items-center p-1 rounded-xl bg-slate-950/90 border border-slate-800 shadow-inner">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
              activeTab === 'chat'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>{t.navChat}</span>
          </button>

          <button
            onClick={() => setActiveTab('admin')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
              activeTab === 'admin'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-950/50'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>{t.navAdmin}</span>
          </button>
        </div>

        {/* Right: Language Selector & Auth */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          
          {/* Language Selector */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/90 border border-slate-800">
            <Globe className="w-4 h-4 text-emerald-400 ml-1.5" />
            {[
              { code: 'en', label: 'EN' },
              { code: 'mr', label: 'मर' },
              { code: 'hi', label: 'हि' }
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => setLang(lang.code)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  currentLang === lang.code
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {/* Auth Section */}
          {isLoggedIn ? (
            /* Logged-in: Show user profile dropdown */
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(prev => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition-all duration-200"
              >
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-5 h-5 rounded-full object-cover border border-emerald-400/40"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/30 border border-emerald-400/40 flex items-center justify-center">
                    <User className="w-3 h-3 text-emerald-300" />
                  </div>
                )}
                <span className="hidden sm:inline max-w-[100px] truncate">{displayName}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-full mt-2 w-52 glass-card rounded-xl p-2 border border-slate-700 shadow-2xl z-50 animate-fadeIn">
                  <div className="px-3 py-2 border-b border-slate-800 mb-1">
                    <p className="text-sm font-bold text-white truncate">{displayName}</p>
                    <p className="text-xs text-slate-400">Farmer Account</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Guest: Show Sign In button */
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all duration-200 shadow-md shadow-emerald-900/30"
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
