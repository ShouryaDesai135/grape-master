import { useEffect, useRef, useState, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import gsap from "gsap";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  ImagePlus,
  Globe,
  Leaf,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { verifyFirebaseToken, getConversations, getConversationMessages, sendChatMessage, submitFeedback, getAdminMetrics, getReviewQueue, submitReviewAction, translateTexts, updateConversationLanguage, updateLanguagePreference } from "./lib/api";
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from "./lib/firebase";
import { translations, LANG_OPTIONS, LANG_DISPLAY, type LangCode } from "./lib/i18n";

const green = "#2D7A4F";

type LanguageContextValue = {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  changeLanguage: (l: LangCode, opts?: { conversationId?: string }) => Promise<void>;
  t: (key: string) => string;
  translating: boolean;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  changeLanguage: async () => {},
  t: (key) => key,
  translating: false,
});

type IconType = typeof Leaf;

type Conversation = {
  id: string;
  title: string;
  preview: string;
  time: string;
  language: string;
  kind: "leaf" | "image" | "water" | "soil";
  confidence?: number;
  flagged?: boolean;
};

const conversations: Conversation[] = [
  { id: "powdery-mildew", title: "Powdery mildew on the north block", preview: "The white patches appeared after last week’s rain…", time: "Yesterday", language: "English", kind: "leaf", confidence: 87 },
  { id: "image-diagnosis", title: "Image diagnosis", preview: "Leaf edges are turning brown and curling inward…", time: "3 days ago", language: "Marathi", kind: "image", flagged: true },
  { id: "drip-irrigation", title: "Drip irrigation schedule", preview: "For 2-year-old vines, start with a shorter morning cycle…", time: "Aug 18", language: "English", kind: "water", confidence: 94 },
  { id: "soil-check", title: "Soil check before pruning", preview: "A balanced NPK reading usually sits around…", time: "Aug 12", language: "Hindi", kind: "soil", confidence: 79 },
];

const navItems = [
  { labelKey: "overview", href: "/home", icon: LayoutDashboard },
  { labelKey: "conversations", href: "/home/chat/new", icon: MessageCircle },
  { labelKey: "savedGuidance", href: "/home/profile", icon: Bookmark },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/home" className="brand-lockup">
      <span className={cn("brand-mark", light && "brand-mark-light")}><Leaf size={18} strokeWidth={2.3} /></span>
      <span className={cn("brand-name", light && "text-white")}>Grape <em>Master</em></span>
    </Link>
  );
}

function getUserInfo() {
  try {
    const raw = localStorage.getItem("user");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { name: "Grape Farmer", email: "farmer@grapemaster.ai" };
}

function Avatar({ initials, size = "md" }: { initials?: string; size?: "sm" | "md" | "lg" }) {
  const user = getUserInfo();
  const displayInitials = initials || (user.name ? user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() : "GF");
  return <span className={cn("avatar", `avatar-${size}`)}>{displayInitials}</span>;
}

function LanguageSwitcher({ conversationId, onTranslateMessages }: { conversationId?: string; onTranslateMessages?: (lang: LangCode) => Promise<void> } = {}) {
  const { lang, changeLanguage, t, translating } = useContext(LanguageContext);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANG_OPTIONS.find((o) => o.code === lang) || LANG_OPTIONS[0];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = async (code: LangCode) => {
    if (code === lang) {
      setOpen(false);
      return;
    }
    setOpen(false);
    await changeLanguage(code, { conversationId });
    if (onTranslateMessages) await onTranslateMessages(code);
  };

  return (
    <div className={cn("lang-dropdown", open && "open")} ref={ref}>
      <button
        type="button"
        className="lang-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chooseLanguage")}
        onClick={() => setOpen((v) => !v)}
        disabled={translating}
      >
        <Globe size={14} strokeWidth={2.2} />
        <span className="lang-dropdown-current">{current.native}</span>
        <ChevronDown size={14} className="lang-chevron" />
      </button>
      {open && (
        <ul className="lang-dropdown-menu" role="listbox">
          <li className="lang-dropdown-heading">{t("chooseLanguage")}</li>
          {LANG_OPTIONS.map((opt) => (
            <li key={opt.code}>
              <button
                type="button"
                role="option"
                aria-selected={opt.code === lang}
                className={cn("lang-dropdown-option", opt.code === lang && "selected")}
                onClick={() => pick(opt.code)}
              >
                <span className="lang-option-short">{opt.short}</span>
                <span className="lang-option-text">
                  <strong>{opt.native}</strong>
                  <small>{opt.label}</small>
                </span>
                {opt.code === lang && <Check size={14} className="lang-option-check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfidenceRing({ value, size = 112, label = "confidence" }: { value: number; size?: number; label?: string }) {
  const ref = useRef<SVGCircleElement>(null);
  const color = value >= 80 ? green : value >= 60 ? "#C98928" : "#D75A4A";
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current, { strokeDashoffset: circumference }, { strokeDashoffset: circumference * (1 - value / 100), duration: 1.4, ease: "power3.out" });
  }, [circumference, value]);
  return (
    <div className="confidence-ring" style={{ width: size, height: size }} aria-label={`${value}% ${label}`}>
      <svg viewBox="0 0 100 100" role="img">
        <circle className="ring-track" cx="50" cy="50" r={radius} />
        <circle ref={ref} className="ring-progress" cx="50" cy="50" r={radius} style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: circumference }} />
      </svg>
      <div className="ring-label"><strong>{value}%</strong><span>{label}</span></div>
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  const user = getUserInfo();
  const { lang, t } = useContext(LanguageContext);
  
  const path = location.split("?")[0];
  const active = path === "/home" ? "/home" : path.startsWith("/home/chat") ? "/home/chat/new" : path;
  
  return (
    <div className="app-shell" lang={lang}>
      <aside className={cn("app-sidebar", mobileMenu && "mobile-open")}>
        <div className="sidebar-top">
          <div className="sidebar-brand-row"><Brand /><button className="icon-btn mobile-close" onClick={() => setMobileMenu(false)}><X size={18} /></button></div>
          <div className="workspace-pill"><span className="workspace-dot" /> {t('myVineyard')} <ChevronDown size={14} /></div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          <p className="eyebrow nav-label">{t('workspace')}</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} onClick={() => setMobileMenu(false)} className={cn("sidebar-link", active === item.href && "active")}><Icon size={17} /><span>{t(item.labelKey)}</span></Link>;
          })}
          <p className="eyebrow nav-label nav-label-spaced">{t('tools')}</p>
          {user.type === "admin" && (
            <Link href="/admin" onClick={() => setMobileMenu(false)} className="sidebar-link"><BarChart3 size={17} /><span>{t('farmInsights')}</span><span className="pro-badge">PRO</span></Link>
          )}
          <button className="sidebar-link sidebar-button"><CircleHelp size={17} /><span>{t('helpCenter')}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <Link href="/home/profile" className="sidebar-profile"><Avatar size="sm" /><span><strong>{user.name || t('farmer')}</strong><small>{user.email || t('farmerAccount')}</small></span><Settings2 size={16} /></Link>
        </div>
      </aside>
      {mobileMenu && <button className="scrim" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
      <main className="app-main">
        <header className="mobile-header"><button className="icon-btn" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><Brand /><div className="mobile-header-actions"><LanguageSwitcher /><Bell size={18} /><Avatar size="sm" /></div></header>
        {children}
      </main>
      <nav className="mobile-bottom-nav"><Link href="/home" className={cn(active === "/home" && "active")}><LayoutDashboard size={19} /><span>{t('dashboard')}</span></Link><Link href="/home/chat/new" className={cn(active === "/home/chat/new" && "active")}><MessageCircle size={19} /><span>{t('askGrape')}</span></Link><Link href="/home/profile" className={cn(active === "/home/profile" && "active")}><UserRound size={19} /><span>{t('profile')}</span></Link></nav>
    </div>
  );
}

function PageReveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current.children, { y: 14 }, { y: 0, duration: 0.55, stagger: 0.06, ease: "power3.out", clearProps: "transform" });
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

function Topbar({ title, kicker, action }: { title: string; kicker?: string; action?: ReactNode }) {
  const { t } = useContext(LanguageContext);
  return <div className="topbar"><div><p className="eyebrow">{kicker || t("myWorkspace")}</p><h1>{title}</h1></div><div className="topbar-actions"><LanguageSwitcher /><button className="icon-btn desktop-only"><Bell size={18} /></button><Avatar size="sm" />{action}</div></div>;
}

function HomePage() {
  const [list, setList] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const { lang, t } = useContext(LanguageContext);

  useEffect(() => {
    getConversations().then((res) => {
      if (res.conversations) {
        setList(res.conversations.map((c: any) => ({
          id: c.id,
          title: c.title || t("vineyardDiagnosis"),
          preview: c.last_message || c.preview || t("readFullGuidance"),
          time: c.updated_at ? new Date(c.updated_at).toLocaleDateString(lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN") : t("justNow"),
          language: LANG_DISPLAY[c.language] || c.language || "English",
          kind: c.title?.toLowerCase().includes("water") || c.title?.toLowerCase().includes("irrigation") ? "water" : c.title?.toLowerCase().includes("soil") ? "soil" : "leaf",
          confidence: c.avg_confidence ? Math.round(c.avg_confidence * 100) : 88,
          flagged: c.has_flagged
        })));
      }
    }).catch(err => {
      console.warn("Failed to load conversations from API, showing initial state:", err);
      setList([]);
    }).finally(() => setLoading(false));
  }, [lang, t]);

  const user = getUserInfo();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("morning") : hour < 18 ? t("afternoon") : t("evening");
  const firstName = user.name ? user.name.split(" ")[0] : t("farmer");
  const dateStr = new Date().toLocaleDateString(lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return <AppShell><PageReveal className="page-content home-content">
    <Topbar title={`${greeting}, ${firstName}`} kicker={dateStr} />
    <section className="hero-grid">
      <div className="hero-copy">
        <div className="hero-kicker"><span className="pulse-dot" /> {t("dailyCheckin")}</div>
        <h2>{t("heroTitle")}<br /><em>{t("heroTitleEm")}</em></h2>
        <p>{t("heroBody")}</p>
        <Link href="/home/chat/new" className="primary-btn large"><Plus size={18} /> {t("startNewConversation")} <ArrowUpRight size={17} /></Link>
        <div className="hero-note"><ShieldCheck size={15} /><span>{t("privateNote")}</span></div>
      </div>
      <div className="insight-card">
        <div className="insight-orb orb-one" /><div className="insight-orb orb-two" />
        <div className="insight-card-top"><span className="label-chip"><Sparkles size={13} /> {t("todaysInsight")}</span><span className="muted-caption">{t("basedOnRecent")}</span></div>
        <div className="insight-body"><div><p className="insight-topic">{t("vineHealth")}</p><h3>{t("insightHeadline")}</h3><p className="insight-text">{t("insightText")}</p></div><ConfidenceRing value={87} size={112} label={t("confidenceBadge")} /></div>
        <Link href="/home/chat/new" className="insight-link">{t("readFullGuidance")} <ArrowUpRight size={15} /></Link>
      </div>
    </section>
    <section className="recent-section"><div className="section-heading"><div><p className="eyebrow">{t("knowledgeTrail")}</p><h2>{t("recentConversations")}</h2></div><Link href="/home/chat/new" className="text-btn">{t("startNew")} <ArrowUpRight size={15} /></Link></div>{loading ? <p className="muted-caption">{t("loadingConversations")}</p> : list.length === 0 ? <div className="conversation-card empty-card" style={{ padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}><Sprout size={28} style={{ color: green }} /><strong>{t("noConversations")}</strong><span className="muted-caption">{t("noConversationsHint")}</span><Link href="/home/chat/new" className="primary-btn" style={{ marginTop: '12px' }}>{t("startFirst")}</Link></div> : <div className="conversation-list">{list.map((item, index) => <ConversationCard key={item.id} item={item} index={index} />)}</div>}</section>
  </PageReveal></AppShell>;
}

function ConversationCard({ item, index = 0 }: { item: Conversation; index?: number }) {
  const { t } = useContext(LanguageContext);
  const Icon = item.kind === "image" ? ImagePlus : item.kind === "water" ? Sprout : item.kind === "soil" ? FlaskConical : Leaf;
  return <Link href={`/home/chat/${item.id}`} className="conversation-card" style={{ animationDelay: `${index * 60}ms` }}><span className={cn("conversation-icon", item.kind)}><Icon size={17} /></span><span className="conversation-main"><strong>{item.title}</strong><span>{item.preview}</span><small>{item.time} <i /> {item.language}</small></span><span className="conversation-meta">{item.flagged ? <span className="flagged-badge"><span /> {t("flagged")}</span> : <span className={cn("confidence-badge", item.confidence && item.confidence >= 80 ? "high" : "medium")}>{item.confidence}% <span>{t("confidenceBadge")}</span></span>}<ChevronRight size={17} /></span></Link>;
}

function ChatPage({ id: routeId }: { id?: string }) {
  const [id, setId] = useState(routeId);
  useEffect(() => { setId(routeId); }, [routeId]);

  const isNew = id === "new" || !id;
  const [messages, setMessages] = useState<Array<{ id?: string; role: "user" | "bot"; text: string; imageUrl?: string; confidence?: number; flagged?: boolean }>>([]);
  const [draft, setDraft] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, number>>({});
  const [langBanner, setLangBanner] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const { lang, t, translating } = useContext(LanguageContext);
  const title = isNew ? t('newChat') : t('vineyardDiagnosis');

  useEffect(() => {
    if (!isNew && id) {
      getConversationMessages(id).then((res) => {
        if (res.messages && res.messages.length > 0) {
          setMessages(res.messages.map((m: any) => ({
            id: m.id,
            role: (m.sender === "user" || m.sender === "farmer") ? "user" : "bot",
            text: m.content || m.text,
            imageUrl: m.image_path ? (m.image_path.startsWith('http') ? m.image_path : `http://localhost:5000${m.image_path.replace(/\\/g, '/')}`) : undefined,
            confidence: m.final_confidence ? Math.round(m.final_confidence * 100) : (m.confidence ? Math.round(m.confidence * 100) : undefined),
            flagged: !!(m.is_flagged || m.flagged)
          })));
        }
      }).catch(err => console.warn("Failed to load message history:", err));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length, loading, translating]);

  const handleFeedback = (msgId?: string, rating?: number) => {
    if (!msgId || !rating) return;
    setFeedbackMap(prev => ({ ...prev, [msgId]: rating }));
    submitFeedback(msgId, rating).catch(err => console.warn("Feedback submit error:", err));
  };

  const translateBotMessages = async (targetLang: LangCode) => {
    const botIndexes: number[] = [];
    const botTexts: string[] = [];
    messages.forEach((m, i) => {
      if (m.role === "bot" && m.text?.trim()) {
        botIndexes.push(i);
        botTexts.push(m.text);
      }
    });
    if (botTexts.length === 0) {
      setLangBanner(`${t("langSwitchBanner")} ${LANG_DISPLAY[targetLang]}`);
      return;
    }
    setLangBanner(t("translating"));
    try {
      const res = await translateTexts(botTexts, targetLang);
      if (res.success && res.translations?.length === botTexts.length) {
        setMessages((prev) => {
          const next = [...prev];
          botIndexes.forEach((idx, j) => {
            next[idx] = { ...next[idx], text: res.translations[j] };
          });
          return next;
        });
      }
    } catch (err) {
      console.warn("Gemini translate failed:", err);
    }
    setLangBanner(`${t("langSwitchBanner")} ${LANG_DISPLAY[targetLang]}`);
  };

  const sendMessage = async (text = draft) => {
    if (!text.trim() && !imageFile) return;

    const userText = text.trim() || t("imageUploaded");
    const tempImageUrl = imageFile ? URL.createObjectURL(imageFile) : undefined;
    
    setMessages((current) => [...current, { role: "user", text: userText, imageUrl: tempImageUrl }]);
    setDraft("");
    setLoading(true);
    setLangBanner(null);

    try {
      const formData = new FormData();
      formData.append("text", userText);
      formData.append("language", lang);
      if (imageFile) {
        formData.append("image", imageFile);
      }
      if (!isNew && id) {
        formData.append("conversationId", id);
      }

      setImageFile(null);
      setAttachmentName(null);

      const response = await sendChatMessage(formData);

      setMessages((current) => [
        ...current,
        {
          id: response.messageId || String(Date.now()),
          role: "bot",
          text: response.answer || response.text || "No response received.",
          confidence: response.confidence ? Math.round(response.confidence * 100) : 85,
          flagged: response.isFlagged || response.flagged
        }
      ]);

      if (isNew && response.conversationId) {
        setId(response.conversationId);
        window.history.replaceState(null, "", `/home/chat/${response.conversationId}`);
      }
    } catch (err: any) {
      console.error("Chat API error:", err);
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: t("connectionError"),
          confidence: 70
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return <AppShell><div className="chat-page"><div className="chat-topbar"><Link href="/home" className="back-link"><ArrowLeft size={18} /> <span>{t('back')}</span></Link><div className="chat-title"><span className="chat-title-icon"><Leaf size={15} /></span><div><strong>{title}</strong><small>{t('online')}</small></div></div><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><LanguageSwitcher conversationId={!isNew && id ? id : undefined} onTranslateMessages={translateBotMessages} /><button className="icon-btn"><MoreHorizontal size={20} /></button></div></div>{(langBanner || translating) && <div className="lang-switch-banner"><Globe size={14} /> {translating ? t("translating") : langBanner}</div>}<div className="chat-thread" ref={threadRef}>{messages.length === 0 ? <div className="chat-empty"><span className="empty-sprout"><Sprout size={25} /></span><p className="eyebrow">{t('yourFarmQuestions')}</p><h2>{t('whatToExplore')}</h2><p>{t('describeVineyard')}</p><div className="suggestion-grid"><button onClick={() => sendMessage(t('spotMildew'))}><Leaf size={16} /> {t('spotMildew')} <ArrowUpRight size={14} /></button><button onClick={() => sendMessage(t('planIrrigation'))}><Sprout size={16} /> {t('planIrrigation')} <ArrowUpRight size={14} /></button><button onClick={() => sendMessage(t('preparePruning'))}><ScissorsIcon /> {t('preparePruning')} <ArrowUpRight size={14} /></button></div></div> : <>{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} feedback={message.id ? feedbackMap[message.id] || null : null} setFeedback={(val) => handleFeedback(message.id, val || undefined)} />)}{loading && <div className="typing-note"><span className="online-dot" /> {t('analyzing')}</div>}</>}</div><div className="composer-wrap">{attachmentName && <div className="attachment-preview"><span><ImagePlus size={15} /> {attachmentName}</span><button onClick={() => { setImageFile(null); setAttachmentName(null); }}><X size={14} /></button></div>}<div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={t('askPlaceholder')} rows={1} /><input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={(event) => { const f = event.target.files?.[0]; if (f) { setImageFile(f); setAttachmentName(f.name); } }} /><button className="composer-icon" onClick={() => fileRef.current?.click()} aria-label="Attach image"><Paperclip size={18} /></button><button className={cn("send-btn", (draft.trim() || imageFile) && "ready")} onClick={() => sendMessage()} aria-label="Send message"><Send size={17} /></button></div><div className="composer-footer"><span><ShieldCheck size={13} /> {t('aiGuidance')}</span><span>{t('pressEnter')}</span></div></div></div></AppShell>;
}

function ScissorsIcon() { return <span className="scissors-icon">✂</span>; }

function MessageBubble({ message, feedback, setFeedback }: { message: { role: "user" | "bot"; text: string; imageUrl?: string; confidence?: number; flagged?: boolean }; feedback: number | null; setFeedback: (value: number | null) => void }) {
  const { t } = useContext(LanguageContext);
  if (message.role === "user") return <div className="message-row user-row"><div className="user-message">{message.imageUrl && <img src={message.imageUrl} alt="Uploaded" className="message-image" style={{ maxWidth: '200px', borderRadius: '8px', marginBottom: '8px' }} />}<p>{message.text}</p><small>{t('justNow')}</small></div></div>;
  return <div className="message-row bot-row"><div className="bot-avatar"><Bot size={17} /></div><div className="bot-message"><p>{message.text}</p>{message.flagged && <div className="flagged-note"><ShieldCheck size={14} /> {t('flaggedNote')}</div>}{message.confidence && <div className="message-bottom"><span className={cn("confidence-badge", message.confidence >= 80 ? "high" : "medium")}>{message.confidence}% {t('confidenceBadge')}</span><span className="feedback-actions"><button className={feedback === 1 ? "selected" : ""} onClick={() => setFeedback(feedback === 1 ? null : 1)}><ThumbsUp size={14} /> {t('helpful')}</button><button className={feedback === -1 ? "selected negative" : ""} onClick={() => setFeedback(feedback === -1 ? null : -1)}><ThumbsDown size={14} /> {t('notQuite')}</button></span></div>}</div></div>;
}

function ProfilePage() {
  const [, navigate] = useLocation();
  const [reminders, setReminders] = useState(() => localStorage.getItem("reminders") !== "false");
  const [alerts, setAlerts] = useState(() => localStorage.getItem("alerts") !== "false");
  const [saved, setSaved] = useState(() => localStorage.getItem("saved") !== "false");
  const user = getUserInfo();
  const { lang, t } = useContext(LanguageContext);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/auth/login");
  };

  return <AppShell><PageReveal className="page-content profile-content"><div className="profile-back-row"><Link href="/home" className="back-link"><ArrowLeft size={16} /> {t("backToOverview")}</Link><span className="profile-status"><span /> {t("profileSynced")}</span></div><Topbar title={t("profileTitle")} kicker={t("yourAccount")} /><div className="profile-grid"><section className="profile-card profile-overview"><div className="profile-cover"><div className="profile-cover-grid" /><div className="cover-sun" /><div className="cover-row cover-row-one" /><div className="cover-row cover-row-two" /><span className="cover-caption">Nashik · Maharashtra</span></div><div className="profile-avatar-wrap"><Avatar size="lg" /><button className="edit-avatar" aria-label="Edit profile photo"><Camera size={13} /></button></div><div className="profile-identity"><h2>{user.name || t("farmer")}</h2><p>{user.email || "Nashik, Maharashtra"}</p><span className="verified-label"><Check size={13} /> {t("accountVerified")}</span></div><div className="profile-details"><div><span>{t("memberSince")}</span><strong>September 2026</strong></div><div><span>{t("preferredLanguage")}</span><div className="profile-lang-wrap"><LanguageSwitcher /></div></div><div><span>{t("farmProfile")}</span><button className="profile-select">{t("grapeVineyard")} <ChevronDown size={14} /></button></div></div><button className="secondary-btn profile-edit-btn"><Settings2 size={15} /> {t("editFarmProfile")}</button><button className="secondary-btn profile-edit-btn" onClick={handleLogout} style={{ marginTop: '8px', color: '#dc2626', borderColor: '#fca5a5' }}><LogOut size={15} /> {t("signOut")}</button></section><section className="profile-card settings-card"><div className="section-heading"><div><p className="eyebrow">{t("personalize")}</p><h2>{t("preferences")}</h2></div><Settings2 size={20} className="muted-icon" /></div><p className="settings-intro">{t("settingsIntro")}</p><div className="setting-row"><div className="setting-icon"><Bell size={17} /></div><div><strong>{t("helpfulReminders")}</strong><span>{t("helpfulRemindersDesc")}</span></div><Toggle on={reminders} onClick={() => { setReminders(!reminders); localStorage.setItem("reminders", String(!reminders)); }} /></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={17} /></div><div><strong>{t("expertReviewAlerts")}</strong><span>{t("expertReviewAlertsDesc")}</span></div><Toggle on={alerts} onClick={() => { setAlerts(!alerts); localStorage.setItem("alerts", String(!alerts)); }} /></div><div className="setting-row"><div className="setting-icon"><Bookmark size={17} /></div><div><strong>{t("savedGuidanceTitle")}</strong><span>{t("savedGuidanceDesc")}</span></div><Toggle on={saved} onClick={() => { setSaved(!saved); localStorage.setItem("saved", String(!saved)); }} /></div><div className="saved-guidance"><div className="saved-guidance-heading"><span><Bookmark size={15} /> {t("recentSaved")}</span><button className="text-btn">{t("viewAll")} <ArrowUpRight size={14} /></button></div><p>“Scout 5–10 vines across the block rather than one plant.”</p><small>Powdery mildew · {LANG_DISPLAY[lang]}</small></div></section></div></PageReveal></AppShell>;
}

function Toggle({ on, onClick }: { on?: boolean; onClick?: () => void }) { return <button className={cn("toggle", on && "on")} onClick={onClick} aria-pressed={on}><span /></button>; }

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { lang, setLang, t } = useContext(LanguageContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const register = mode === "register";

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const { idToken } = await signInWithGoogle();
      const res = await verifyFirebaseToken(idToken, name, lang);
      if (res.token) {
        localStorage.setItem("token", res.token);
        if (res.farmer) localStorage.setItem("user", JSON.stringify({ ...res.farmer, preferredLanguage: lang }));
        else if (res.user) localStorage.setItem("user", JSON.stringify(res.user));
        localStorage.setItem("preferredLanguage", lang);
        navigate("/home");
      } else {
        setError(res.error || "Authentication failed. Please try again.");
      }
    } catch (err: any) {
      const msg = err?.code ? friendlyFirebaseError(err.code) : (err?.message || "Google sign-in failed. Please try again.");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { idToken } = register
        ? await signUpWithEmail(email, password)
        : await signInWithEmail(email, password);
      
      const res = await verifyFirebaseToken(idToken, name, lang);
      if (res.token) {
        localStorage.setItem("token", res.token);
        if (res.farmer) localStorage.setItem("user", JSON.stringify({ ...res.farmer, preferredLanguage: lang }));
        else if (res.user) localStorage.setItem("user", JSON.stringify(res.user));
        localStorage.setItem("preferredLanguage", lang);
        navigate("/home");
      } else {
        setError(res.error || "Authentication failed. Please try again.");
      }
    } catch (err: any) {
      const msg = err?.code ? friendlyFirebaseError(err.code) : (err?.message || "Sign-in failed. Please check your credentials.");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return <div className="auth-page" lang={lang}><div className="auth-visual"><div className="auth-visual-noise" /><div className="auth-visual-geometry"><span className="geometry-ring ring-one" /><span className="geometry-ring ring-two" /><span className="geometry-block block-one" /><span className="geometry-block block-two" /><span className="geometry-line geometry-line-one" /><span className="geometry-line geometry-line-two" /></div><div className="auth-brand"><Brand light /></div><div className="auth-visual-copy"><p className="eyebrow light-eyebrow"><span className="pulse-dot light" /> {t("builtForField")}</p><h1>{t("authHeroTitle")}<br /><em>{t("authHeroEm")}</em></h1><p>{t("authHeroBody")}</p></div><div className="auth-quote"><span>“</span><p>{t("authQuote")}</p><small>{t("authQuoteAuthor")}</small></div></div><div className="auth-form-side"><div className="auth-form-wrap"><div className="auth-mobile-brand"><Brand /></div><div className="auth-lang-row"><LanguageSwitcher /></div><div className="auth-heading"><span className="auth-heading-icon"><Sprout size={18} /></span><p className="eyebrow">{register ? t("startFieldNotes") : t("welcomeBackFarm")}</p><h2>{register ? t("createAccount") : t("welcomeBack")}</h2><p>{register ? t("authRegisterSub") : t("authLoginSub")}</p></div>        <form onSubmit={submit} className="auth-form">
          {register && <label>{t("fullName")}<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Ramesh Salunkhe" /></label>}
          <label>{t("emailAddress")}<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>{t("password")}
            <div className="password-input">
              <input required minLength={8} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("passwordPlaceholder")} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? t("hide") : t("show")}</button>
            </div>
            {register && <span className="field-hint">{t("passwordHint")}</span>}
          </label>
          {register && <div className="language-field">
            <span>{t("preferredLanguage")}</span>
            <div className="language-options">
              {LANG_OPTIONS.map((opt) => <button type="button" key={opt.code} className={lang === opt.code ? "selected" : ""} onClick={() => setLang(opt.code)}>{opt.short}</button>)}
            </div>
          </div>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-btn auth-submit" disabled={loading}>{loading ? <span className="spinner" /> : register ? t("createAccountBtn") : t("signIn")}<ArrowUpRight size={16} /></button>
        </form><div className="auth-divider"><span>{t("orContinue")}</span></div><button type="button" className="google-btn" onClick={handleGoogleSignIn} disabled={loading}><span className="google-g">G</span> {t("continueGoogle")}</button><p className="auth-switch">{register ? t("alreadyHave") : t("dontHave")} <Link href={register ? "/auth/login" : "/auth/register"}>{register ? t("signIn") : t("createOne")}</Link></p><p className="auth-terms">{t("termsAgree")} <a href="#terms">{t("terms")}</a> {t("and")} <a href="#privacy">{t("privacy")}</a>.</p></div></div></div>;
}

function SplashPage() {
  const [, navigate] = useLocation();
  const { t } = useContext(LanguageContext);
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => { const timeline = gsap.timeline({ onComplete: () => navigate("/auth/login") }); timeline.fromTo(pathRef.current, { strokeDasharray: 260, strokeDashoffset: 260 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut" }).fromTo(".splash-copy > *", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" }, "-=0.3"); return () => { timeline.kill(); }; }, [navigate]);
  return <div className="splash-page"><div className="splash-logo"><svg viewBox="0 0 120 100"><path ref={pathRef} d="M32 72C56 70 78 57 88 29M32 72C27 51 36 32 54 24M32 72C53 77 72 80 91 74M55 24C67 19 80 21 88 29" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /><path d="M32 72C49 62 63 53 76 39" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div><div className="splash-copy"><h1>Grape <em>Master</em></h1><p>{t("splashTagline")}</p><span>{t("preparingNotes")}</span></div><div className="splash-footer"><Sprout size={13} /> {t("growConfidence")}</div></div>;
}

function AdminLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const [location, navigate] = useLocation();
  const user = getUserInfo();

  useEffect(() => {
    if (user.type !== "admin") {
      navigate("/admin/login");
    }
  }, [user.type, navigate]);

  if (user.type !== "admin") return null;

  return <div className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span className="admin-brand-mark"><Leaf size={17} /></span><div><strong>Grape Master</strong><small>Field intelligence</small></div></div><div className="admin-workspace"><span className="workspace-dot admin-dot" /> Admin workspace <ChevronDown size={14} /></div><nav><p className="admin-nav-label">Manage</p><Link href="/admin" className={location === "/admin" ? "active" : ""}><LayoutDashboard size={17} /> Overview</Link><Link href="/admin/review" className={location === "/admin/review" ? "active" : ""}><ClipboardList size={17} /> Review queue <span className="admin-count">7</span></Link><Link href="/admin/analytics" className={location === "/admin/analytics" ? "active" : ""}><BarChart3 size={17} /> FAQ analytics</Link><p className="admin-nav-label admin-spaced">System</p><button><Users size={17} /> Farmers</button><button><Settings2 size={17} /> Settings</button></nav><div className="admin-sidebar-foot"><div className="admin-status"><span /> All systems operational</div><Link href="/home" className="back-to-farmer"><ArrowLeft size={15} /> Farmer view</Link></div></aside><main className="admin-main"><header className="admin-topbar"><div><p className="eyebrow">Admin workspace / {title}</p><h1>{title}</h1><p>{subtitle}</p></div><div className="admin-topbar-actions"><button className="admin-date"><Clock3 size={15} /> Last 30 days <ChevronDown size={14} /></button><button className="icon-btn admin-icon"><Bell size={18} /></button><Avatar initials="AD" size="sm" /></div></header>{children}</main></div>;
}

function AdminOverview() {
  return <AdminLayout title="Overview" subtitle="A quick pulse on how farmers are finding answers."><PageReveal className="admin-page"><div className="admin-kpi-grid"><AdminKpi label="Active farmers" value="1,284" change="+12.8%" icon={Users} tone="green" /><AdminKpi label="Questions answered" value="8,642" change="+18.4%" icon={MessageCircle} tone="blue" /><AdminKpi label="Avg. confidence" value="86.7%" change="+3.2%" icon={ShieldCheck} tone="amber" /><AdminKpi label="Needs review" value="7" change="-2 today" icon={ClipboardList} tone="red" /></div><div className="admin-grid-two"><section className="admin-panel chart-panel"><div className="panel-heading"><div><p className="eyebrow">Usage at a glance</p><h2>Questions answered</h2></div><span className="chart-stat">8,642 <small>total</small></span></div><div className="fake-chart"><div className="chart-y"><span>500</span><span>250</span><span>0</span></div><div className="chart-lines"><span /><span /><span /><svg viewBox="0 0 560 190" preserveAspectRatio="none"><path d="M0 150 C30 125 48 147 75 118 S120 104 142 126 S175 75 208 93 S244 52 274 73 S314 86 346 58 S385 76 414 39 S450 52 475 31 S520 57 560 17" fill="none" stroke={green} strokeWidth="3" strokeLinecap="round" /><path d="M0 150 C30 125 48 147 75 118 S120 104 142 126 S175 75 208 93 S244 52 274 73 S314 86 346 58 S385 76 414 39 S450 52 475 31 S520 57 560 17 V190 H0 Z" fill="url(#chartFill)" opacity=".17" /><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={green} /><stop offset="1" stopColor="#fff" /></linearGradient></defs></svg></div><div className="chart-x"><span>Sep 1</span><span>Sep 8</span><span>Sep 15</span><span>Sep 22</span></div></div></section><section className="admin-panel language-panel"><div className="panel-heading"><div><p className="eyebrow">Distribution</p><h2>By language</h2></div><MoreHorizontal size={18} className="muted-icon" /></div><div className="donut-wrap"><div className="donut"><div><strong>8.6k</strong><span>questions</span></div></div><div className="legend"><span><i className="legend-en" /> English <b>54%</b></span><span><i className="legend-hi" /> Hindi <b>28%</b></span><span><i className="legend-mr" /> Marathi <b>18%</b></span></div></div></section></div><div className="admin-grid-two"><section className="admin-panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Attention needed</p><h2>Review queue</h2></div><Link href="/admin/review" className="text-btn">Open queue <ArrowUpRight size={14} /></Link></div><div className="review-preview"><ReviewMini title="Leaf disease identification" lang="Marathi" confidence="61%" time="12 min ago" /><ReviewMini title="Fertilizer timing for new vines" lang="English" confidence="73%" time="38 min ago" /><ReviewMini title="Brown spots after rain" lang="Hindi" confidence="68%" time="1 hr ago" /></div></section><section className="admin-panel intent-panel"><div className="panel-heading"><div><p className="eyebrow">What farmers ask</p><h2>Top intents</h2></div><MoreHorizontal size={18} className="muted-icon" /></div><div className="intent-bars"><IntentBar label="Disease & pests" value={82} count="2,184" /><IntentBar label="Irrigation" value={68} count="1,807" /><IntentBar label="Treatment" value={54} count="1,436" /><IntentBar label="Fertilizer" value={40} count="1,062" /><IntentBar label="Pruning" value={29} count="768" /></div></section></div></PageReveal></AdminLayout>;
}

function AdminKpi({ label, value, change, icon: Icon, tone }: { label: string; value: string; change: string; icon: IconType; tone: string }) { return <section className="admin-kpi"><div className={cn("kpi-icon", tone)}><Icon size={18} /></div><span className="kpi-label">{label}</span><strong>{value}</strong><small className={tone === "red" ? "negative" : "positive"}><TrendingUp size={12} /> {change}</small></section>; }
function ReviewMini({ title, lang, confidence, time }: { title: string; lang: string; confidence: string; time: string }) { return <Link href="/admin/review" className="review-mini"><span className="review-mini-icon"><ShieldCheck size={15} /></span><span><strong>{title}</strong><small>{lang} <i /> {time}</small></span><span className="review-confidence">{confidence}<small>confidence</small></span><ChevronRight size={15} /></Link>; }
function IntentBar({ label, value, count }: { label: string; value: number; count: string }) { return <div className="intent-row"><div><span>{label}</span><b>{count}</b></div><div className="intent-track"><span style={{ width: `${value}%` }} /></div></div>; }

function ReviewPage() {
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [queue, setQueue] = useState<any[]>([
    { id: "1", title: "Leaf disease identification", query: "माझ्या द्राक्षाच्या पानांवर पांढरे डाग आहेत. हे काय आहे?", response: "हे पांढरे डाग पावडरी मिल्ड्यूचे लक्षण असू शकतात. सल्फर फवारणीचा विचार करा.", confidence: "61%", lang: "Marathi" },
    { id: "2", title: "Fertilizer timing for new vines", query: "When should I apply the first fertilizer to young vines?", response: "Apply a balanced fertilizer after the first active growth flush.", confidence: "73%", lang: "English" },
    { id: "3", title: "Brown spots after rain", query: "बारिश के बाद पत्तियों पर भूरे निशान दिख रहे हैं।", response: "बारिश के बाद नमी से फंगल संक्रमण हो सकता है। पत्तों की जाँच करें।", confidence: "68%", lang: "Hindi" }
  ]);

  useEffect(() => {
    getReviewQueue().then(res => {
      if (res.queue && res.queue.length > 0) {
        setQueue(res.queue.map((q: any) => ({
          id: q.id,
          title: q.user_query ? q.user_query.slice(0, 30) + "…" : "Flagged query",
          query: q.user_query,
          response: q.bot_response,
          confidence: Math.round((q.confidence_score || 0.6) * 100) + "%",
          lang: q.language === "hi" ? "Hindi" : q.language === "mr" ? "Marathi" : "English"
        })));
      }
    }).catch(err => console.warn("Failed to load review queue:", err));
  }, []);

  const handleAction = async (approved: boolean) => {
    if (selected >= queue.length) return;
    const currentItem = queue[selected];
    setSubmitting(true);
    try {
      await submitReviewAction(currentItem.id, answer || currentItem.response, approved);
      setQueue(prev => prev.filter((_, idx) => idx !== selected));
      setAnswer("");
      if (selected > 0) setSelected(selected - 1);
    } catch (err) {
      console.error("Failed to submit review action:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const item = queue[selected] || queue[0] || { title: "Queue empty", query: "-", response: "-", confidence: "0%", lang: "English" };

  return <AdminLayout title="Review queue" subtitle="Give every answer the confidence it deserves."><div className="review-layout"><section className="admin-panel queue-panel"><div className="queue-heading"><div><p className="eyebrow">{queue.length} pending items</p><h2>Needs expert review</h2></div><button className="filter-btn"><Search size={15} /> Filter</button></div>{queue.map((entry, index) => <button key={entry.id || entry.title} className={cn("queue-item", selected === index && "selected")} onClick={() => setSelected(index)}><span className="queue-item-top"><span className="review-mini-icon"><ShieldCheck size={15} /></span><small>{entry.lang}</small><span className="queue-time">Recent</span></span><strong>{entry.title}</strong><span className="queue-item-bottom"><span className="low-confidence">{entry.confidence} confidence</span><ChevronRight size={15} /></span></button>)}</section><section className="admin-panel review-detail"><div className="detail-heading"><div><p className="eyebrow">Review item {queue.length > 0 ? selected + 1 : 0} of {queue.length}</p><h2>{item.title}</h2></div><span className="flag-chip"><span /> Low confidence</span></div><div className="detail-block"><span className="detail-label">Original question · {item.lang}</span><p>{item.query}</p></div><div className="detail-block system-response"><span className="detail-label">System response</span><p>{item.response}</p><span className="detail-confidence"><ShieldCheck size={14} /> {item.confidence} confidence</span></div><label className="correction-label"><span className="detail-label">Expert correction</span><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write a clearer, more useful response for the farmer…" rows={6} /></label><div className="detail-actions"><button className="reject-btn" disabled={submitting || queue.length === 0} onClick={() => handleAction(false)}><X size={15} /> Reject</button><button className="approve-btn" disabled={submitting || queue.length === 0} onClick={() => handleAction(true)}><Check size={15} /> Approve & submit</button></div></section></div></AdminLayout>;
}

function AnalyticsPage() {
  const [lang, setLang] = useState("All languages");
  return <AdminLayout title="FAQ analytics" subtitle="See what farmers are asking, and where to go deeper."><PageReveal className="admin-page"><div className="analytics-toolbar"><div className="analytics-filters"><button><span>Language</span>{lang}<ChevronDown size={14} /></button><button><span>Region</span>All regions<ChevronDown size={14} /></button><button><span>Date range</span>Last 30 days<ChevronDown size={14} /></button></div><button className="export-btn" onClick={() => { const csv = "Question,Count,Avg confidence\nHow often should I irrigate?,684,91%\nWhat causes powdery mildew?,512,87%"; const blob = new Blob([csv], { type: "text/csv" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "grape-master-faq.csv"; link.click(); }}><Download size={15} /> Export dataset</button></div><div className="analytics-cards"><AdminKpi label="Unique questions" value="2,418" change="+9.4%" icon={CircleHelp} tone="green" /><AdminKpi label="Top intent" value="Disease" change="38% of total" icon={FlaskConical} tone="amber" /><AdminKpi label="Best performing language" value="EN" change="89.4% avg. confidence" icon={MessageCircle} tone="blue" /></div><section className="admin-panel faq-table-panel"><div className="panel-heading"><div><p className="eyebrow">Most asked this month</p><h2>Top questions</h2></div><div className="table-search"><Search size={15} /><input placeholder="Search questions" /></div></div><table><thead><tr><th>Question</th><th>Intent</th><th>Language</th><th>Asked</th><th>Avg. confidence</th></tr></thead><tbody>{[["How often should I irrigate young vines?", "Irrigation", "English", "684", "91%"], ["What causes powdery mildew?", "Disease", "English", "512", "87%"], ["When is the right time to prune?", "Pruning", "Marathi", "406", "84%"], ["Which fertilizer is best after flowering?", "Fertilizer", "Hindi", "388", "82%"], ["Leaves turning yellow at the edges", "Disease", "English", "297", "78%"]].map((row) => <tr key={row[0]}><td><strong>{row[0]}</strong></td><td><span className="intent-chip">{row[1]}</span></td><td>{row[2]}</td><td>{row[3]}</td><td><span className="table-confidence">{row[4]}</span></td></tr>)}</tbody></table></section></PageReveal></AdminLayout>;
}
function LoginRoute() { return <AuthPage mode="login" />; }
function RegisterRoute() { return <AuthPage mode="register" />; }
function ChatRoute({ params }: { params: { id: string } }) { return <ChatPage id={params.id} />; }
function NewChatRoute() { return <ChatPage id="new" />; }

// Maps Firebase error codes to friendly messages
function friendlyFirebaseError(code: string): string {
  const map: Record<string, string> = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email. Please register first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Incorrect email or password. Please try again.',
    'auth/too-many-requests': 'Too many failed attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
  };
  return map[code] || `Sign-in error (${code}). Please try again.`;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(import.meta.env.VITE_API_URL + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then(r => r.json());
      if (res.success) {
        localStorage.setItem("token", res.token);
        localStorage.setItem("user", JSON.stringify({ ...res.admin, type: 'admin' }));
        navigate("/admin");
      } else {
        setError(res.error || "Login failed");
      }
    } catch (err) {
      setError("Network error");
    }
    setLoading(false);
  };

  return <div className="auth-page" style={{ justifyContent: 'center', background: '#f9fafb' }}>
    <div className="auth-form-wrap" style={{ maxWidth: '400px', width: '100%', margin: '0 auto' }}>
      <div className="auth-heading">
        <span className="auth-heading-icon"><ShieldCheck size={18} /></span>
        <h2>Admin Access</h2>
        <p>Restricted area for Grape Master agronomists.</p>
      </div>
      <form onSubmit={submit} className="auth-form">
        <label>Work Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@grapemaster.ai" /></label>
        <label>Password<input required type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-btn auth-submit" disabled={loading}>{loading ? <span className="spinner" /> : "Sign in"}</button>
      </form>
      <Link href="/home" className="text-btn" style={{ marginTop: '20px', justifyContent: 'center' }}><ArrowLeft size={14} /> Back to farmer view</Link>
    </div>
  </div>;
}

function App() {
  const [lang, setLangState] = useState<LangCode>(() => {
    const saved = localStorage.getItem("preferredLanguage");
    if (saved === "hi" || saved === "mr" || saved === "en") return saved;
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.preferredLanguage === "hi" || user.preferredLanguage === "mr" || user.preferredLanguage === "en") {
        return user.preferredLanguage;
      }
    } catch {}
    return "en";
  });
  const [translating, setTranslating] = useState(false);

  const setLang = (l: LangCode) => {
    setLangState(l);
    localStorage.setItem("preferredLanguage", l);
    document.documentElement.lang = l === "hi" ? "hi" : l === "mr" ? "mr" : "en";
  };

  const changeLanguage = async (l: LangCode, opts?: { conversationId?: string }) => {
    if (l === lang) return;
    setTranslating(true);
    setLang(l);
    try {
      if (localStorage.getItem("token")) {
        await updateLanguagePreference(l).catch(() => {});
        if (opts?.conversationId) {
          await updateConversationLanguage(opts.conversationId, l).catch(() => {});
        }
      }
    } finally {
      setTranslating(false);
    }
  };

  const t = (key: string) => translations[lang]?.[key] || translations.en[key] || key;

  useEffect(() => {
    document.documentElement.lang = lang === "hi" ? "hi" : lang === "mr" ? "mr" : "en";
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, changeLanguage, t, translating }}>
      <Switch>
        <Route path="/" component={SplashPage} />
        <Route path="/auth/login" component={LoginRoute} />
        <Route path="/auth/register" component={RegisterRoute} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/home/chat/new" component={NewChatRoute} />
        <Route path="/home/chat/:id" component={ChatRoute} />
        <Route path="/home/profile" component={ProfilePage} />
        <Route path="/home" component={HomePage} />
        <Route path="/admin/review" component={ReviewPage} />
        <Route path="/admin/analytics" component={AnalyticsPage} />
        <Route path="/admin" component={AdminOverview} />
        <Route component={SplashPage} />
      </Switch>
    </LanguageContext.Provider>
  );
}
export default App;
// Keep this symbol in the bundle so the design system can be tuned from one place.
void green;
