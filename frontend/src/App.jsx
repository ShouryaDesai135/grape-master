import React, { useState } from 'react';
import Header from './components/Header';
import ChatInterface from './components/ChatInterface';
import AdminDashboard from './components/AdminDashboard';
import AuthModal from './components/AuthModal';
import { AuthProvider } from './utils/useAuth';

export default function App() {
  const [currentLang, setLang]     = useState('en');
  const [activeTab, setActiveTab]  = useState('chat');
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col bg-[#051712] text-slate-100 font-sans selection:bg-emerald-500 selection:text-white">

        <Header
          currentLang={currentLang}
          setLang={setLang}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenAuth={() => setIsAuthOpen(true)}
        />

        <main className="flex-1">
          {activeTab === 'chat' ? (
            <ChatInterface
              currentLang={currentLang}
              onOpenAuth={() => setIsAuthOpen(true)}
            />
          ) : (
            <AdminDashboard currentLang={currentLang} />
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
