import React, { useState } from 'react';
import Header from './components/Header';
import ChatInterface from './components/ChatInterface';
import AdminDashboard from './components/AdminDashboard';
import AdminLoginModal from './components/AdminLoginModal';
import AuthModal from './components/AuthModal';
import { AuthProvider } from './utils/useAuth';
import {
  updateConversationLanguage,
  updatePreferences,
  getFarmerToken,
  getAdminToken,
  clearAdminToken,
} from './utils/api';

function hasValidAdminToken() {
  const token = getAdminToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearAdminToken();
      return false;
    }
    return payload.type === 'admin';
  } catch {
    return false;
  }
}

export default function App() {
  const [currentLang, setCurrentLang]               = useState(() => localStorage.getItem('gm_lang') || 'en');
  const [activeTab, setActiveTab]                   = useState('chat');
  const [isAuthOpen, setIsAuthOpen]                 = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [isAdminAuthed, setIsAdminAuthed]           = useState(() => hasValidAdminToken());

  async function handleLanguageChange(newLang) {
    setCurrentLang(newLang);
    localStorage.setItem('gm_lang', newLang);

    if (activeConversationId) {
      try {
        await updateConversationLanguage(activeConversationId, newLang);
      } catch (e) {
        console.error('Language sync failed', e);
      }
    } else if (getFarmerToken()) {
      try {
        await updatePreferences({ preferredLanguage: newLang });
      } catch (e) {
        console.error('Preference sync failed', e);
      }
    }
  }

  function handleAdminLogout() {
    clearAdminToken();
    setIsAdminAuthed(false);
    setActiveTab('chat');
  }

  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col bg-[#051712] text-slate-100 font-sans selection:bg-emerald-500 selection:text-white">

        <Header
          currentLang={currentLang}
          setLang={handleLanguageChange}
          activeTab={activeTab}
          setActiveTab={(tab) => {
            if (tab === 'admin') {
              setIsAdminAuthed(hasValidAdminToken());
            }
            setActiveTab(tab);
          }}
          onOpenAuth={() => setIsAuthOpen(true)}
        />

        <main className="flex-1">
          {activeTab === 'chat' ? (
            <ChatInterface
              currentLang={currentLang}
              onOpenAuth={() => setIsAuthOpen(true)}
              onConversationChange={setActiveConversationId}
            />
          ) : isAdminAuthed ? (
            <AdminDashboard
              currentLang={currentLang}
              onAdminLogout={handleAdminLogout}
            />
          ) : (
            <AdminLoginModal
              onSuccess={() => setIsAdminAuthed(true)}
              onCancel={() => setActiveTab('chat')}
            />
          )}
        </main>

        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
        />

      </div>
    </AuthProvider>
  );
}
