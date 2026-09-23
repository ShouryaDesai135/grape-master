/**
 * ChatInterface.jsx — Real Backend-Connected Chat
 * ═══════════════════════════════════════════════
 * 
 * - Calls POST /api/chat (multipart/form-data) for every message
 * - Requires user to be logged in; shows sign-in prompt if not
 * - Persists conversation ID across messages (multi-turn memory)
 * - Loads past conversation history on first load
 * - Supports text + image (multimodal) queries
 * - Shows CNN vision diagnosis card + LLM text answer together
 * - Feedback buttons call POST /api/feedback (real)
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Image as ImageIcon, Volume2, VolumeX, ThumbsUp, ThumbsDown,
  Sparkles, AlertTriangle, ShieldCheck, CheckCircle2, RefreshCw,
  Mic, X, LogIn, MessageSquare,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { translations } from '../utils/translations';
import { sendChatMessage, submitFeedback, getConversations, getConversationMessages } from '../utils/api';
import { useAuth } from '../utils/useAuth';

// ── Helpers ──────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }) {
  const pct = Math.round((confidence || 0) * 100);
  const isHigh = pct >= 75;
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 border ${
      isHigh
        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
        : 'bg-amber-500/10 border-amber-500/40 text-amber-400'
    }`}>
      {isHigh
        ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
      }
      {pct}% {isHigh ? 'High Confidence' : 'Needs Review'}
    </span>
  );
}

function DiagnosisSection({ label, icon: Icon, color, content }) {
  if (!content) return null;
  return (
    <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
      <div className={`flex items-center gap-2 text-xs font-bold ${color} mb-1.5`}>
        <Icon className="w-4 h-4" /> {label}
      </div>
      <p className="text-slate-300 text-xs leading-relaxed">{content}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function ChatInterface({ currentLang, onOpenAuth }) {
  const t = translations[currentLang];
  const { isLoggedIn, displayName } = useAuth();

  const [messages, setMessages]         = useState([]);
  const [inputText, setInputText]       = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isLoading, setIsLoading]       = useState(false);
  const [speakingId, setSpeakingId]     = useState(null);
  const [feedbackGiven, setFeedbackGiven] = useState({});
  const [conversationId, setConversationId] = useState(null);
  const [pastConvos, setPastConvos]     = useState([]);
  const [showHistory, setShowHistory]   = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [apiError, setApiError]         = useState(null);

  const chatEndRef  = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Load conversations when user logs in
  useEffect(() => {
    if (isLoggedIn) {
      loadConversations();
      // Show welcome back message if starting fresh
      if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          sender: 'bot',
          type: 'text',
          text: t.heroSubtitle,
          timestamp: now()
        }]);
      }
    } else {
      // Reset on logout
      setMessages([]);
      setConversationId(null);
      setPastConvos([]);
    }
  }, [isLoggedIn]);

  async function loadConversations() {
    try {
      const convos = await getConversations();
      setPastConvos(convos);
    } catch (err) {
      console.error('Could not load conversations:', err);
    }
  }

  async function loadConversation(convoId) {
    setHistoryLoading(true);
    setShowHistory(false);
    try {
      const result = await getConversationMessages(convoId);
      setConversationId(convoId);
      // Map DB messages to our display format
      const mapped = (result.messages || []).map(m => ({
        id: m.id,
        sender: m.sender === 'farmer' ? 'user' : 'bot',
        type: m.sender === 'bot' ? 'text' : 'text',
        text: m.content,
        timestamp: new Date(m.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        messageId: m.id,
        cnnPrediction: m.cnn_prediction,
        finalConfidence: m.final_confidence,
      }));
      setMessages(mapped);
    } catch (err) {
      setApiError('Could not load conversation history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  // ── Image Upload ──────────────────────────────────────────────
  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  // ── Text-to-Speech ────────────────────────────────────────────
  const handleTTS = (msgId, text) => {
    if (!('speechSynthesis' in window)) return;
    if (speakingId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (currentLang === 'mr')      utterance.lang = 'mr-IN';
    else if (currentLang === 'hi') utterance.lang = 'hi-IN';
    else                           utterance.lang = 'en-IN';
    utterance.onend  = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  // ── Feedback ──────────────────────────────────────────────────
  const handleFeedback = async (msgId, backendMsgId, rating) => {
    setFeedbackGiven(prev => ({ ...prev, [msgId]: rating }));
    if (backendMsgId) {
      try {
        await submitFeedback(backendMsgId, rating);
      } catch (err) {
        console.error('Feedback error:', err);
      }
    }
  };

  // ── Send Message ──────────────────────────────────────────────
  const handleSend = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() && !selectedImage) return;
    if (!isLoggedIn) { onOpenAuth(); return; }

    setApiError(null);

    // Add optimistic user message
    const userMsgId = `user-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      sender: 'user',
      type: imagePreview ? 'multimodal' : 'text',
      text: inputText || (currentLang === 'mr' ? 'पान तपासा' : currentLang === 'hi' ? 'पत्ता जांचें' : 'Analyze this leaf'),
      image: imagePreview,
      timestamp: now()
    };
    setMessages(prev => [...prev, userMsg]);

    const queryText = inputText;
    const queryImage = selectedImage;
    setInputText('');
    setSelectedImage(null);
    setImagePreview(null);
    setIsLoading(true);

    try {
      const result = await sendChatMessage({
        text: queryText,
        imageFile: queryImage,
        conversationId,
      });

      if (result.success) {
        if (!conversationId) {
          setConversationId(result.conversationId);
          // Refresh sidebar conversations
          loadConversations();
        }

        const botMsgId = `bot-${Date.now()}`;
        const botMsg = {
          id: botMsgId,
          sender: 'bot',
          type: result.diagnosis ? 'diagnostic_response' : 'text',
          text: result.answer,
          diagnosis: result.diagnosis,
          confidence: result.confidence,
          isFlagged: result.isFlagged,
          messageId: result.messageId,
          timestamp: now()
        };
        setMessages(prev => [...prev, botMsg]);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setApiError(err.message);
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        sender: 'bot',
        type: 'error',
        text: `⚠️ ${err.message}`,
        timestamp: now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Voice Input ───────────────────────────────────────────────
  const handleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not supported'); return; }
    const rec = new SR();
    rec.lang = currentLang === 'mr' ? 'mr-IN' : currentLang === 'hi' ? 'hi-IN' : 'en-IN';
    rec.start();
    rec.onresult = (e) => setInputText(e.results[0][0].transcript);
  };

  // ── Not Logged In State ───────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] text-center">
        <div className="text-7xl mb-6">🍇</div>
        <h2 className="text-3xl font-extrabold text-white mb-3">{t.heroTitle}</h2>
        <p className="text-slate-400 max-w-md mb-8 leading-relaxed">{t.heroSubtitle}</p>
        <button
          onClick={onOpenAuth}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-sm shadow-xl shadow-emerald-900/30 hover:from-emerald-400 hover:to-teal-400 transition-all"
        >
          <LogIn className="w-5 h-5" />
          Sign In to Start Chatting
        </button>
        <p className="text-slate-500 text-xs mt-4">Register for free — no credit card required</p>
      </div>
    );
  }

  // ── Logged-in Chat UI ─────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col min-h-[calc(100vh-80px)]">

      {/* Welcome + History Panel */}
      <div className="glass-card rounded-2xl p-5 mb-5 relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Multi-lingual AI + Vision RAG
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-white">
              Welcome back, <span className="gradient-text-emerald">{displayName}</span> 👋
            </h2>
            <p className="text-xs text-slate-400 mt-1">{t.heroSubtitle}</p>
          </div>

          <div className="flex flex-col gap-2 w-full md:w-auto">
            {/* History Toggle */}
            {pastConvos.length > 0 && (
              <button
                onClick={() => setShowHistory(prev => !prev)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-all"
              >
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                Past Conversations ({pastConvos.length})
                <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showHistory ? 'rotate-180' : ''}`} />
              </button>
            )}

            {/* New Chat */}
            <button
              onClick={() => { setMessages([{ id: 'welcome', sender: 'bot', type: 'text', text: t.heroSubtitle, timestamp: now() }]); setConversationId(null); setShowHistory(false); }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> New Conversation
            </button>
          </div>
        </div>

        {/* Past Conversations Dropdown */}
        {showHistory && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-1.5 animate-fadeIn">
            <p className="text-xs font-bold text-slate-400 mb-2">Select a past conversation to continue:</p>
            {historyLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /> Loading...
              </div>
            ) : (
              pastConvos.map(c => (
                <button
                  key={c.id}
                  onClick={() => loadConversation(c.id)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800 text-xs text-slate-300 hover:text-white transition-all"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="flex-1 truncate">{c.title || 'Conversation'}</span>
                  <span className="text-slate-500 flex-shrink-0">
                    {c.language?.toUpperCase() || 'EN'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* API Error Banner */}
      {apiError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs mb-4 animate-fadeIn">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{apiError}</span>
          <button onClick={() => setApiError(null)} className="hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto space-y-5 pb-32 pr-1">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>

            {/* User Bubble */}
            {msg.sender === 'user' && (
              <div className="max-w-xl rounded-2xl rounded-tr-none px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-950/40">
                {msg.image && (
                  <div className="mb-2 rounded-xl overflow-hidden border border-white/20">
                    <img src={msg.image} alt="Uploaded leaf" className="max-h-48 w-full object-cover" />
                  </div>
                )}
                <p className="text-sm font-medium leading-relaxed">{msg.text}</p>
                <span className="text-[10px] text-emerald-200/80 text-right block mt-1">{msg.timestamp}</span>
              </div>
            )}

            {/* Bot: Diagnostic Response (with CNN + LLM answer) */}
            {msg.sender === 'bot' && msg.type === 'diagnostic_response' && (
              <div className="w-full max-w-3xl glass-card rounded-2xl p-5 md:p-6 border border-emerald-500/30 shadow-2xl">

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-emerald-500/20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xl">🍇</div>
                    <div>
                      <h3 className="text-base font-bold text-white">
                        {msg.diagnosis?.prediction
                          ? msg.diagnosis.prediction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          : 'Agricultural Advisory'}
                      </h3>
                      <p className="text-xs text-slate-400">Vision + AI Advisory Analysis</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {msg.confidence != null && <ConfidenceBadge confidence={msg.confidence} />}
                    <button
                      onClick={() => handleTTS(msg.id, msg.text)}
                      className={`p-2 rounded-xl border transition-all ${
                        speakingId === msg.id
                          ? 'bg-purple-600 border-purple-400 text-white animate-pulse'
                          : 'bg-slate-900/80 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50'
                      }`}
                    >
                      {speakingId === msg.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* CNN Diagnosis Info */}
                {msg.diagnosis && (
                  <div className="mt-3 mb-4 flex flex-wrap gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                      📷 CNN: {msg.diagnosis.prediction?.replace(/_/g, ' ')}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs">
                      Vision Confidence: {Math.round((msg.diagnosis.confidence || 0) * 100)}%
                    </span>
                    {msg.isFlagged && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Flagged for expert review
                      </span>
                    )}
                  </div>
                )}

                {/* LLM Answer */}
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
                  <p className="text-slate-100 text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                </div>

                {/* Feedback */}
                <div className="mt-4 pt-3 border-t border-emerald-500/20 flex items-center justify-between text-xs text-slate-400">
                  <span>Was this advisory helpful?</span>
                  <div className="flex items-center gap-2">
                    {feedbackGiven[msg.id] ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t.feedbackThanks}
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleFeedback(msg.id, msg.messageId, 1)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/30 text-emerald-300 transition-all"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" /> {t.feedbackHelpful}
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, msg.messageId, -1)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-all"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" /> {t.feedbackNotHelpful}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Bot: Plain Text Message */}
            {msg.sender === 'bot' && (msg.type === 'text' || msg.type === 'error') && (
              <div className={`max-w-2xl glass-card rounded-2xl rounded-tl-none px-5 py-4 border ${
                msg.type === 'error'
                  ? 'border-red-500/30 bg-red-950/20 text-red-300'
                  : 'border-emerald-500/30 text-slate-200'
              } text-sm leading-relaxed shadow-lg`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.sender === 'bot' && msg.type === 'text' && msg.id !== 'welcome' && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-emerald-500/10">
                    <button
                      onClick={() => handleTTS(msg.id, msg.text)}
                      className="p-1.5 rounded-lg bg-slate-900/60 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-900/40 transition-all"
                    >
                      {speakingId === msg.id ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    {feedbackGiven[msg.id] ? (
                      <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Thanks!
                      </span>
                    ) : (
                      <>
                        <button onClick={() => handleFeedback(msg.id, msg.messageId, 1)} className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-emerald-400 hover:bg-emerald-900/40 transition-all">
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleFeedback(msg.id, msg.messageId, -1)} className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-slate-400 hover:bg-slate-800 transition-all">
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <span className="text-[10px] text-slate-600 mt-1 mx-1">{msg.timestamp}</span>
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex items-center gap-3 p-4 rounded-2xl glass-card border border-emerald-500/40 w-fit animate-fadeIn">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <span className="text-xs font-semibold text-emerald-300 animate-pulse block">{t.analyzingImage}</span>
              <span className="text-[10px] text-slate-500">Gemini + RAG + CNN Vision</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Dock */}
      <div className="fixed bottom-4 left-0 right-0 max-w-4xl mx-auto px-4 z-40">

        {/* Image Preview */}
        {imagePreview && (
          <div className="mb-2 p-2 rounded-xl glass-card border border-emerald-500/40 flex items-center justify-between w-fit gap-3 animate-fadeIn">
            <div className="flex items-center gap-2">
              <img src={imagePreview} alt="Preview" className="w-12 h-12 rounded-lg object-cover border border-emerald-500/50" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">Grape Photo Ready</p>
                <p className="text-[10px] text-slate-400">Will be analyzed by CNN Vision</p>
              </div>
            </div>
            <button
              onClick={() => { setSelectedImage(null); setImagePreview(null); }}
              className="p-1 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSend} className="glass-input rounded-2xl p-2 flex items-center gap-2 shadow-2xl">

          <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 hover:glow-emerald transition-all"
            title={t.uploadPhoto}
          >
            <ImageIcon className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isLoggedIn ? t.inputPlaceholder : 'Sign in to start chatting...'}
            disabled={!isLoggedIn}
            className="flex-1 bg-transparent text-white placeholder-slate-400 text-sm px-2 focus:outline-none disabled:opacity-50"
          />

          <button
            type="button"
            onClick={handleVoice}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-purple-950/80 border border-purple-500/30 text-purple-400 transition-all hidden sm:flex"
            title={t.voiceSearch}
          >
            <Mic className="w-5 h-5" />
          </button>

          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedImage) || isLoading}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <span>{t.sendBtn}</span>
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

    </div>
  );
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
