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
import { verifyFirebaseToken, getConversations, getConversationMessages, sendChatMessage, submitFeedback, getAdminMetrics, getReviewQueue, submitReviewAction } from "./lib/api";
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from "./lib/firebase";

const green = "#2D7A4F";

const translations: Record<string, Record<string, string>> = {
  en: {
    newChat: "New Chat",
    vineyardDiagnosis: "Vineyard Diagnosis",
    back: "Back",
    online: "Grape Master advisor · online",
    yourFarmQuestions: "Your farm, your questions",
    whatToExplore: "What would you like to explore today?",
    describeVineyard: "Describe what you’re seeing in the vineyard. You can also attach a photo for a closer look.",
    spotMildew: "Spot early mildew",
    planIrrigation: "Plan irrigation",
    preparePruning: "Prepare for pruning",
    analyzing: "Grape Master is analyzing your input…",
    helpful: "Helpful",
    notQuite: "Not quite",
    aiGuidance: "AI guidance for your farm · Always use your judgement in the field",
    pressEnter: "Press Enter to send",
    justNow: "Just now",
    flagged: "This response has been flagged for expert review.",
    confidenceBadge: "confidence",
    workspace: "Workspace",
    tools: "Tools",
    helpCenter: "Help center",
    myVineyard: "My vineyard",
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    farmer: "Farmer",
    startNew: "Start a new conversation",
    askPlaceholder: "Ask about your vines…",
    send: "Send message",
    recent: "Recent activity",
    loading: "Grape Master is thinking...",
    overview: "Overview",
    dashboard: "Dashboard",
    history: "Past discussions",
    adminWorkspace: "Admin workspace",
    farmInsights: "Farm insights"
  },
  hi: {
    newChat: "नई चैट",
    vineyardDiagnosis: "खेत का निदान",
    back: "पीछे",
    online: "ग्रेप मास्टर सलाहकार · ऑनलाइन",
    yourFarmQuestions: "आपका खेत, आपके प्रश्न",
    whatToExplore: "आज आप क्या जानना चाहेंगे?",
    describeVineyard: "बताएं कि आप खेत में क्या देख रहे हैं। आप एक फोटो भी जोड़ सकते हैं।",
    spotMildew: "शुरुआती फफूंदी पहचानें",
    planIrrigation: "सिंचाई की योजना बनाएं",
    preparePruning: "कटाई की तैयारी करें",
    analyzing: "ग्रेप मास्टर विश्लेषण कर रहा है…",
    helpful: "मददगार",
    notQuite: "सटीक नहीं",
    aiGuidance: "आपके खेत के लिए एआई मार्गदर्शन · हमेशा अपने निर्णय का उपयोग करें",
    pressEnter: "भेजने के लिए एंटर दबाएं",
    justNow: "अभी",
    flagged: "विशेषज्ञ की समीक्षा के लिए इसे चिह्नित किया गया है।",
    confidenceBadge: "आत्मविश्वास",
    workspace: "कार्यक्षेत्र",
    tools: "उपकरण",
    helpCenter: "सहायता केंद्र",
    myVineyard: "मेरा खेत",
    morning: "शुभ प्रभात",
    afternoon: "नमस्कार",
    evening: "शुभ संध्या",
    farmer: "किसान",
    startNew: "नई बातचीत शुरू करें",
    askPlaceholder: "अपनी अंगूर की बेलों के बारे में पूछें...",
    send: "संदेश भेजें",
    recent: "हाल की गतिविधि",
    loading: "ग्रेप मास्टर सोच रहा है...",
    overview: "अवलोकन",
    dashboard: "डैशबोर्ड",
    history: "पिछली चर्चाएँ",
    adminWorkspace: "प्रशासक कार्यक्षेत्र",
    farmInsights: "कृषि अंतर्दृष्टि"
  },
  mr: {
    newChat: "नवीन चॅट",
    vineyardDiagnosis: "द्राक्षबाग निदान",
    back: "मागे",
    online: "ग्रेप मास्टर सल्लागार · ऑनलाइन",
    yourFarmQuestions: "तुमचे शेत, तुमचे प्रश्न",
    whatToExplore: "आज तुम्हाला काय जाणून घ्यायला आवडेल?",
    describeVineyard: "तुम्ही द्राक्षबागेत काय पाहत आहात ते सांगा. तुम्ही फोटोही जोडू शकता.",
    spotMildew: "लवकर बुरशी ओळखा",
    planIrrigation: "सिंचनाचे नियोजन करा",
    preparePruning: "छाटणीची तयारी करा",
    analyzing: "ग्रेप मास्टर विश्लेषण करत आहे…",
    helpful: "मदतगार",
    notQuite: "अचूक नाही",
    aiGuidance: "तुमच्या शेतासाठी एआय मार्गदर्शन · नेहमी तुमचा स्वतःचा निर्णय घ्या",
    pressEnter: "पाठवण्यासाठी एंटर दाबा",
    justNow: "आत्ताच",
    flagged: "तज्ञांच्या पुनरावलोकनासाठी हे चिन्हांकित केले आहे.",
    confidenceBadge: "आत्मविश्वास",
    workspace: "कार्यक्षेत्र",
    tools: "साधने",
    helpCenter: "मदत केंद्र",
    myVineyard: "माझी द्राक्षबाग",
    morning: "शुभ सकाळ",
    afternoon: "नमस्कार",
    evening: "शुभ संध्याकाळ",
    farmer: "शेतकरी",
    startNew: "नवीन संभाषण सुरू करा",
    askPlaceholder: "आपल्या द्राक्षवेलींबद्दल विचारा...",
    send: "संदेश पाठवा",
    recent: "अलीकडील क्रियाकलाप",
    loading: "ग्रेप मास्टर विचार करत आहे...",
    overview: "आढावा",
    dashboard: "डॅशबोर्ड",
    history: "मागील चर्चा",
    adminWorkspace: "प्रशासक कार्यक्षेत्र",
    farmInsights: "कृषी अंतर्दृष्टी"
  }
};

const LanguageContext = createContext({
  lang: 'en',
  setLang: (l: string) => {},
  t: (key: string) => key
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
  { label: "Overview", href: "/home", icon: LayoutDashboard },
  { label: "Conversations", href: "/home/chat/new", icon: MessageCircle },
  { label: "Saved guidance", href: "/home/profile", icon: Bookmark },
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

function LanguageSwitcher() {
  const { lang, setLang } = useContext(LanguageContext);
  return (
    <select value={lang} onChange={e => setLang(e.target.value)} className="lang-select" style={{ padding: '4px', borderRadius: '4px', border: '1px solid #e2e8f0', background: 'transparent', fontSize: '13px', cursor: 'pointer' }}>
      <option value="en">English</option><option value="hi">हिंदी</option><option value="mr">मराठी</option>
    </select>
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
  const { lang, setLang, t } = useContext(LanguageContext);
  
  const path = location.split("?")[0];
  const active = path === "/home" ? "/home" : path.startsWith("/home/chat") ? "/home/chat/new" : path;
  
  return (
    <div className="app-shell">
      <aside className={cn("app-sidebar", mobileMenu && "mobile-open")}>
        <div className="sidebar-top">
          <div className="sidebar-brand-row"><Brand /><button className="icon-btn mobile-close" onClick={() => setMobileMenu(false)}><X size={18} /></button></div>
          <div className="workspace-pill"><span className="workspace-dot" /> {t('myVineyard')} <ChevronDown size={14} /></div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          <p className="eyebrow nav-label">{t('workspace')}</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} onClick={() => setMobileMenu(false)} className={cn("sidebar-link", active === item.href && "active")}><Icon size={17} /><span>{t(item.label.toLowerCase()) || item.label}</span></Link>;
          })}
          <p className="eyebrow nav-label nav-label-spaced">{t('tools')}</p>
          {user.type === "admin" && (
            <Link href="/admin" onClick={() => setMobileMenu(false)} className="sidebar-link"><BarChart3 size={17} /><span>{t('farmInsights')}</span><span className="pro-badge">PRO</span></Link>
          )}
          <button className="sidebar-link sidebar-button"><CircleHelp size={17} /><span>{t('helpCenter')}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <Link href="/home/profile" className="sidebar-profile"><Avatar size="sm" /><span><strong>{user.name || t('farmer')}</strong><small>{user.email || "Farmer account"}</small></span><Settings2 size={16} /></Link>
        </div>
      </aside>
      {mobileMenu && <button className="scrim" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
      <main className="app-main">
        <header className="mobile-header"><button className="icon-btn" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><Brand /><div className="mobile-header-actions"><LanguageSwitcher /><Bell size={18} /><Avatar size="sm" /></div></header>
        {children}
      </main>
      <nav className="mobile-bottom-nav"><Link href="/home" className={cn(active === "/home" && "active")}><LayoutDashboard size={19} /><span>{t('dashboard')}</span></Link><Link href="/home/chat/new" className={cn(active === "/home/chat/new" && "active")}><MessageCircle size={19} /><span>Ask Grape</span></Link><Link href="/home/profile" className={cn(active === "/home/profile" && "active")}><UserRound size={19} /><span>Profile</span></Link></nav>
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
  return <div className="topbar"><div><p className="eyebrow">{kicker || "My workspace"}</p><h1>{title}</h1></div><div className="topbar-actions"><LanguageSwitcher /><button className="icon-btn desktop-only"><Bell size={18} /></button><Avatar size="sm" />{action}</div></div>;
}

function HomePage() {
  const [list, setList] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConversations().then((res) => {
      if (res.conversations) {
        setList(res.conversations.map((c: any) => ({
          id: c.id,
          title: c.title || "Vine consultation",
          preview: c.last_message || c.preview || "Click to view full guidance…",
          time: c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "Recent",
          language: c.language || "English",
          kind: c.title?.toLowerCase().includes("water") || c.title?.toLowerCase().includes("irrigation") ? "water" : c.title?.toLowerCase().includes("soil") ? "soil" : "leaf",
          confidence: c.avg_confidence ? Math.round(c.avg_confidence * 100) : 88,
          flagged: c.has_flagged
        })));
      }
    }).catch(err => {
      console.warn("Failed to load conversations from API, showing initial state:", err);
      setList([]);
    }).finally(() => setLoading(false));
  }, []);

  const user = getUserInfo();
  
  // Create dynamic greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user.name ? user.name.split(" ")[0] : "Farmer";
  
  // Format current date dynamically
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return <AppShell><PageReveal className="page-content home-content">
    <Topbar title={`${greeting}, ${firstName}`} kicker={dateStr} />
    <section className="hero-grid">
      <div className="hero-copy">
        <div className="hero-kicker"><span className="pulse-dot" /> Your daily vineyard check-in</div>
        <h2>Let’s keep your<br /><em>vines thriving.</em></h2>
        <p>Ask anything about your crop, from leaf health to the next best time to irrigate. I’ll bring the farm knowledge.</p>
        <Link href="/home/chat/new" className="primary-btn large"><Plus size={18} /> Start a new conversation <ArrowUpRight size={17} /></Link>
        <div className="hero-note"><ShieldCheck size={15} /><span>Private to your farm · Answers reviewed for clarity</span></div>
      </div>
      <div className="insight-card">
        <div className="insight-orb orb-one" /><div className="insight-orb orb-two" />
        <div className="insight-card-top"><span className="label-chip"><Sparkles size={13} /> Today’s insight</span><span className="muted-caption">Based on your recent questions</span></div>
        <div className="insight-body"><div><p className="insight-topic">Vine health</p><h3>Keep an eye on the north block this week.</h3><p className="insight-text">Humidity is expected to stay high. Early morning scouting will help you catch mildew before it spreads.</p></div><ConfidenceRing value={87} size={112} label="confidence" /></div>
        <Link href="/home/chat/new" className="insight-link">Read the full guidance <ArrowUpRight size={15} /></Link>
      </div>
    </section>
    <section className="recent-section"><div className="section-heading"><div><p className="eyebrow">Your knowledge trail</p><h2>Recent conversations</h2></div><Link href="/home/chat/new" className="text-btn">Start new <ArrowUpRight size={15} /></Link></div>{loading ? <p className="muted-caption">Loading your farm conversations…</p> : list.length === 0 ? <div className="conversation-card empty-card" style={{ padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}><Sprout size={28} style={{ color: green }} /><strong>No conversations yet</strong><span className="muted-caption">Ask a question about your vineyard or upload a leaf photo to get started.</span><Link href="/home/chat/new" className="primary-btn" style={{ marginTop: '12px' }}>Start your first conversation</Link></div> : <div className="conversation-list">{list.map((item, index) => <ConversationCard key={item.id} item={item} index={index} />)}</div>}</section>
  </PageReveal></AppShell>;
}

function ConversationCard({ item, index = 0 }: { item: Conversation; index?: number }) {
  const Icon = item.kind === "image" ? ImagePlus : item.kind === "water" ? Sprout : item.kind === "soil" ? FlaskConical : Leaf;
  return <Link href={`/home/chat/${item.id}`} className="conversation-card" style={{ animationDelay: `${index * 60}ms` }}><span className={cn("conversation-icon", item.kind)}><Icon size={17} /></span><span className="conversation-main"><strong>{item.title}</strong><span>{item.preview}</span><small>{item.time} <i /> {item.language}</small></span><span className="conversation-meta">{item.flagged ? <span className="flagged-badge"><span /> Flagged</span> : <span className={cn("confidence-badge", item.confidence && item.confidence >= 80 ? "high" : "medium")}>{item.confidence}% <span>confidence</span></span>}<ChevronRight size={17} /></span></Link>;
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
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const { lang, t } = useContext(LanguageContext);
  const title = isNew ? t('newChat') : "Vineyard Diagnosis";

  useEffect(() => {
    if (!isNew && id) {
      getConversationMessages(id).then((res) => {
        if (res.messages && res.messages.length > 0) {
          setMessages(res.messages.map((m: any) => ({
            id: m.id,
            role: (m.sender === "user" || m.sender === "farmer") ? "user" : "bot",
            text: m.content || m.text,
            imageUrl: m.image_path ? (m.image_path.startsWith('http') ? m.image_path : `http://localhost:5000${m.image_path.replace(/\\/g, '/')}`) : undefined,
            confidence: m.confidence ? Math.round(m.confidence * 100) : undefined,
            flagged: m.flagged
          })));
        }
      }).catch(err => console.warn("Failed to load message history:", err));
    }
  }, [id, isNew]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length, loading]);

  const handleFeedback = (msgId?: string, rating?: number) => {
    if (!msgId || !rating) return;
    setFeedbackMap(prev => ({ ...prev, [msgId]: rating }));
    submitFeedback(msgId, rating).catch(err => console.warn("Feedback submit error:", err));
  };

  const sendMessage = async (text = draft) => {
    if (!text.trim() && !imageFile) return;

    const userText = text.trim() || "Image uploaded for analysis.";
    const tempImageUrl = imageFile ? URL.createObjectURL(imageFile) : undefined;
    
    setMessages((current) => [...current, { role: "user", text: userText, imageUrl: tempImageUrl }]);
    setDraft("");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("text", userText);
      formData.append("language", lang); // Send active language explicitly
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
          flagged: response.flagged
        }
      ]);

      if (isNew && response.conversationId) {
        // Group follow-ups into the same conversation without a full page reload
        setId(response.conversationId);
        window.history.replaceState(null, "", `/home/chat/${response.conversationId}`);
      }
    } catch (err: any) {
      console.error("Chat API error:", err);
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: "I am having trouble connecting to the advisory server. Please ensure the backend is running.",
          confidence: 70
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return <AppShell><div className="chat-page"><div className="chat-topbar"><Link href="/home" className="back-link"><ArrowLeft size={18} /> <span>{t('back')}</span></Link><div className="chat-title"><span className="chat-title-icon"><Leaf size={15} /></span><div><strong>{title}</strong><small>{t('online')}</small></div></div><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><LanguageSwitcher /><button className="icon-btn"><MoreHorizontal size={20} /></button></div></div><div className="chat-thread" ref={threadRef}>{messages.length === 0 ? <div className="chat-empty"><span className="empty-sprout"><Sprout size={25} /></span><p className="eyebrow">{t('yourFarmQuestions')}</p><h2>{t('whatToExplore')}</h2><p>{t('describeVineyard')}</p><div className="suggestion-grid"><button onClick={() => sendMessage(t('spotMildew'))}><Leaf size={16} /> {t('spotMildew')} <ArrowUpRight size={14} /></button><button onClick={() => sendMessage(t('planIrrigation'))}><Sprout size={16} /> {t('planIrrigation')} <ArrowUpRight size={14} /></button><button onClick={() => sendMessage(t('preparePruning'))}><ScissorsIcon /> {t('preparePruning')} <ArrowUpRight size={14} /></button></div></div> : <>{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} feedback={message.id ? feedbackMap[message.id] || null : null} setFeedback={(val) => handleFeedback(message.id, val || undefined)} />)}{loading && <div className="typing-note"><span className="online-dot" /> {t('analyzing')}</div>}</>}</div><div className="composer-wrap">{attachmentName && <div className="attachment-preview"><span><ImagePlus size={15} /> {attachmentName}</span><button onClick={() => { setImageFile(null); setAttachmentName(null); }}><X size={14} /></button></div>}<div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={t('askPlaceholder')} rows={1} /><input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={(event) => { const f = event.target.files?.[0]; if (f) { setImageFile(f); setAttachmentName(f.name); } }} /><button className="composer-icon" onClick={() => fileRef.current?.click()} aria-label="Attach image"><Paperclip size={18} /></button><button className={cn("send-btn", (draft.trim() || imageFile) && "ready")} onClick={() => sendMessage()} aria-label="Send message"><Send size={17} /></button></div><div className="composer-footer"><span><ShieldCheck size={13} /> {t('aiGuidance')}</span><span>{t('pressEnter')}</span></div></div></div></AppShell>;
}

function ScissorsIcon() { return <span className="scissors-icon">✂</span>; }

function MessageBubble({ message, feedback, setFeedback }: { message: { role: "user" | "bot"; text: string; imageUrl?: string; confidence?: number; flagged?: boolean }; feedback: number | null; setFeedback: (value: number | null) => void }) {
  const { t } = useContext(LanguageContext);
  if (message.role === "user") return <div className="message-row user-row"><div className="user-message">{message.imageUrl && <img src={message.imageUrl} alt="Uploaded" className="message-image" style={{ maxWidth: '200px', borderRadius: '8px', marginBottom: '8px' }} />}<p>{message.text}</p><small>{t('justNow')}</small></div></div>;
  return <div className="message-row bot-row"><div className="bot-avatar"><Bot size={17} /></div><div className="bot-message"><p>{message.text}</p>{message.flagged && <div className="flagged-note"><ShieldCheck size={14} /> {t('flagged')}</div>}{message.confidence && <div className="message-bottom"><span className={cn("confidence-badge", message.confidence >= 80 ? "high" : "medium")}>{message.confidence}% {t('confidenceBadge')}</span><span className="feedback-actions"><button className={feedback === 1 ? "selected" : ""} onClick={() => setFeedback(feedback === 1 ? null : 1)}><ThumbsUp size={14} /> {t('helpful')}</button><button className={feedback === -1 ? "selected negative" : ""} onClick={() => setFeedback(feedback === -1 ? null : -1)}><ThumbsDown size={14} /> {t('notQuite')}</button></span></div>}</div></div>;
}

function ProfilePage() {
  const [, navigate] = useLocation();
  const [reminders, setReminders] = useState(() => localStorage.getItem("reminders") !== "false");
  const [alerts, setAlerts] = useState(() => localStorage.getItem("alerts") !== "false");
  const [saved, setSaved] = useState(() => localStorage.getItem("saved") !== "false");
  const user = getUserInfo();

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/auth/login");
  };

  return <AppShell><PageReveal className="page-content profile-content"><div className="profile-back-row"><Link href="/home" className="back-link"><ArrowLeft size={16} /> Back to overview</Link><span className="profile-status"><span /> Profile synced</span></div><Topbar title="Profile & preferences" kicker="Your account" /><div className="profile-grid"><section className="profile-card profile-overview"><div className="profile-cover"><div className="profile-cover-grid" /><div className="cover-sun" /><div className="cover-row cover-row-one" /><div className="cover-row cover-row-two" /><span className="cover-caption">Nashik · Maharashtra</span></div><div className="profile-avatar-wrap"><Avatar size="lg" /><button className="edit-avatar" aria-label="Edit profile photo"><Camera size={13} /></button></div><div className="profile-identity"><h2>{user.name || "Grape Farmer"}</h2><p>{user.email || "Smallholder grape farmer · Nashik, Maharashtra"}</p><span className="verified-label"><Check size={13} /> Account verified</span></div><div className="profile-details"><div><span>Member since</span><strong>September 2026</strong></div><div><span>Preferred language</span><button className="profile-select">English <ChevronDown size={14} /></button></div><div><span>Farm profile</span><button className="profile-select">Grape vineyard <ChevronDown size={14} /></button></div></div><button className="secondary-btn profile-edit-btn"><Settings2 size={15} /> Edit farm profile</button><button className="secondary-btn profile-edit-btn" onClick={handleLogout} style={{ marginTop: '8px', color: '#dc2626', borderColor: '#fca5a5' }}><LogOut size={15} /> Sign out</button></section><section className="profile-card settings-card"><div className="section-heading"><div><p className="eyebrow">Personalize your experience</p><h2>Preferences</h2></div><Settings2 size={20} className="muted-icon" /></div><p className="settings-intro">Choose how Grape Master keeps you informed while you work in the field.</p><div className="setting-row"><div className="setting-icon"><Bell size={17} /></div><div><strong>Helpful reminders</strong><span>Get a gentle nudge for saved follow-ups</span></div><Toggle on={reminders} onClick={() => { setReminders(!reminders); localStorage.setItem("reminders", String(!reminders)); }} /></div><div className="setting-row"><div className="setting-icon"><ShieldCheck size={17} /></div><div><strong>Expert review alerts</strong><span>Know when a response is flagged for review</span></div><Toggle on={alerts} onClick={() => { setAlerts(!alerts); localStorage.setItem("alerts", String(!alerts)); }} /></div><div className="setting-row"><div className="setting-icon"><Bookmark size={17} /></div><div><strong>Saved guidance</strong><span>Keep answers close for your next field visit</span></div><Toggle on={saved} onClick={() => { setSaved(!saved); localStorage.setItem("saved", String(!saved)); }} /></div><div className="saved-guidance"><div className="saved-guidance-heading"><span><Bookmark size={15} /> Recent saved guidance</span><button className="text-btn">View all <ArrowUpRight size={14} /></button></div><p>“Scout 5–10 vines across the block rather than one plant.”</p><small>Powdery mildew on the north block · saved yesterday</small></div></section></div></PageReveal></AppShell>;
}

function Toggle({ on, onClick }: { on?: boolean; onClick?: () => void }) { return <button className={cn("toggle", on && "on")} onClick={onClick} aria-pressed={on}><span /></button>; }

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedLang, setSelectedLang] = useState("EN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const register = mode === "register";

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const { idToken } = await signInWithGoogle();
      const res = await verifyFirebaseToken(idToken, name);
      if (res.token) {
        localStorage.setItem("token", res.token);
        if (res.farmer) localStorage.setItem("user", JSON.stringify(res.farmer));
        else if (res.user) localStorage.setItem("user", JSON.stringify(res.user));
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
      
      const res = await verifyFirebaseToken(idToken, name);
      if (res.token) {
        localStorage.setItem("token", res.token);
        if (res.farmer) localStorage.setItem("user", JSON.stringify(res.farmer));
        else if (res.user) localStorage.setItem("user", JSON.stringify(res.user));
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

  return <div className="auth-page"><div className="auth-visual"><div className="auth-visual-noise" /><div className="auth-visual-geometry"><span className="geometry-ring ring-one" /><span className="geometry-ring ring-two" /><span className="geometry-block block-one" /><span className="geometry-block block-two" /><span className="geometry-line geometry-line-one" /><span className="geometry-line geometry-line-two" /></div><div className="auth-brand"><Brand light /></div><div className="auth-visual-copy"><p className="eyebrow light-eyebrow"><span className="pulse-dot light" /> Built for the field</p><h1>Good decisions<br /><em>grow here.</em></h1><p>A calmer way to understand your vines, one question at a time.</p></div><div className="auth-quote"><span>“</span><p>The best farming advice is the kind you can use before the sun gets too high.</p><small>— Grape Master field notes</small></div></div><div className="auth-form-side"><div className="auth-form-wrap"><div className="auth-mobile-brand"><Brand /></div><div className="auth-heading"><span className="auth-heading-icon"><Sprout size={18} /></span><p className="eyebrow">{register ? "Start your field notes" : "Welcome back to your farm"}</p><h2>{register ? "Create your account" : "Welcome back"}</h2><p>{register ? "A little more clarity for every season." : "Your vineyard, your questions, your progress."}</p></div>        <form onSubmit={submit} className="auth-form">
          {register && <label>Full name<input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Ramesh Salunkhe" /></label>}
          <label>Email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password
            <div className="password-input">
              <input required minLength={8} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button>
            </div>
            {register && <span className="field-hint">Use at least 8 characters</span>}
          </label>
          {register && <div className="language-field">
            <span>Preferred language</span>
            <div className="language-options">
              {["EN", "हि", "म"].map((lang) => <button type="button" key={lang} className={selectedLang === lang ? "selected" : ""} onClick={() => setSelectedLang(lang)}>{lang}</button>)}
            </div>
          </div>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-btn auth-submit" disabled={loading}>{loading ? <span className="spinner" /> : register ? "Create account" : "Sign in"}<ArrowUpRight size={16} /></button>
        </form><div className="auth-divider"><span>or continue with</span></div><button type="button" className="google-btn" onClick={handleGoogleSignIn} disabled={loading}><span className="google-g">G</span> Continue with Google</button><p className="auth-switch">{register ? "Already have an account?" : "Don't have an account?"} <Link href={register ? "/auth/login" : "/auth/register"}>{register ? "Sign in" : "Create one"}</Link></p><p className="auth-terms">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p></div></div></div>;
}

function SplashPage() {
  const [, navigate] = useLocation();
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => { const timeline = gsap.timeline({ onComplete: () => navigate("/auth/login") }); timeline.fromTo(pathRef.current, { strokeDasharray: 260, strokeDashoffset: 260 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut" }).fromTo(".splash-copy > *", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" }, "-=0.3"); return () => { timeline.kill(); }; }, [navigate]);
  return <div className="splash-page"><div className="splash-logo"><svg viewBox="0 0 120 100"><path ref={pathRef} d="M32 72C56 70 78 57 88 29M32 72C27 51 36 32 54 24M32 72C53 77 72 80 91 74M55 24C67 19 80 21 88 29" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /><path d="M32 72C49 62 63 53 76 39" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div><div className="splash-copy"><h1>Grape <em>Master</em></h1><p>Your AI farm advisor</p><span>Preparing your field notes</span></div><div className="splash-footer"><Sprout size={13} /> Grow with confidence</div></div>;
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
  const [lang, setLang] = useState('en');
  const t = (key: string) => translations[lang]?.[key] || translations['en'][key] || key;
  return <LanguageContext.Provider value={{ lang, setLang, t }}><Switch><Route path="/" component={SplashPage} /><Route path="/auth/login" component={LoginRoute} /><Route path="/auth/register" component={RegisterRoute} /><Route path="/admin/login" component={AdminLogin} /><Route path="/home/chat/new" component={NewChatRoute} /><Route path="/home/chat/:id" component={ChatRoute} /><Route path="/home/profile" component={ProfilePage} /><Route path="/home" component={HomePage} /><Route path="/admin/review" component={ReviewPage} /><Route path="/admin/analytics" component={AnalyticsPage} /><Route path="/admin" component={AdminOverview} /><Route component={SplashPage} /></Switch></LanguageContext.Provider>;
}
export default App;
// Keep this symbol in the bundle so the design system can be tuned from one place.
void green;
