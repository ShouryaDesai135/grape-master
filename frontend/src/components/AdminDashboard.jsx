import React, { useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts';
import { 
  LayoutDashboard, ShieldAlert, CheckCircle, Clock, Download, 
  Send, Sparkles, MessageSquare, Database, AlertTriangle, FileSpreadsheet, RefreshCw
} from 'lucide-react';
import { translations } from '../utils/translations';
import { initialAdminMetrics } from '../utils/sampleData';

export default function AdminDashboard({ currentLang }) {
  const t = translations[currentLang];
  const [metrics, setMetrics] = useState(initialAdminMetrics);
  const [reviewQueue, setReviewQueue] = useState(initialAdminMetrics.flaggedQueue);
  const [expertAnswers, setExpertAnswers] = useState({});
  const [solvedNotice, setSolvedNotice] = useState(null);

  // Handle expert review submission
  const handleAnswerSubmit = (queryId) => {
    const answer = expertAnswers[queryId];
    if (!answer?.trim()) return;

    // Remove solved query from review queue
    setReviewQueue(prev => prev.filter(item => item.id !== queryId));
    setMetrics(prev => ({
      ...prev,
      flaggedCount: prev.flaggedCount - 1,
      totalQueries: prev.totalQueries + 1
    }));

    setSolvedNotice(`Query ${queryId} verified & added to RAG Retraining Knowledge Base!`);
    setTimeout(() => setSolvedNotice(null), 3000);
  };

  // Export JSON / CSV Dataset
  const handleExportDataset = (format = 'json') => {
    const dataStr = format === 'csv'
      ? "ID,Query,Language,Confidence,Status\n" + reviewQueue.map(q => `"${q.id}","${q.farmerQuery}","${q.language}",${q.confidence},"FLAGGED"`).join("\n")
      : JSON.stringify(reviewQueue, null, 2);

    const blob = new Blob([dataStr], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grape_master_retraining_dataset.${format}`;
    link.click();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      
      {/* Header Banner */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute -left-10 -bottom-10 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/30 flex items-center gap-1">
              <LayoutDashboard className="w-3.5 h-3.5 text-purple-400" /> Admin Control
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white">{t.adminTitle}</h2>
          <p className="text-xs text-slate-300 mt-1">{t.adminSubtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExportDataset('json')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-900/60 hover:bg-purple-800 border border-purple-500/30 text-purple-200 text-xs font-semibold transition-all shadow-md"
          >
            <Download className="w-4 h-4" /> JSON Dataset
          </button>
          <button
            onClick={() => handleExportDataset('csv')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-500/30 text-emerald-200 text-xs font-semibold transition-all shadow-md"
          >
            <FileSpreadsheet className="w-4 h-4" /> CSV Dataset
          </button>
        </div>
      </div>

      {/* Solved Notification */}
      {solvedNotice && (
        <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{solvedNotice}</span>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="glass-panel rounded-2xl p-5 border border-emerald-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.totalQueries}</span>
            <MessageSquare className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{metrics.totalQueries}</p>
          <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
            +18% from last week
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-purple-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.avgConfidence}</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{metrics.avgConfidence}%</p>
          <span className="text-[10px] text-purple-300 font-medium flex items-center gap-1 mt-1">
            High Accuracy Threshold
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-amber-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.flaggedQueries}</span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-amber-300">{metrics.flaggedCount}</p>
          <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1 mt-1">
            Requires Expert Review
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-blue-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.avgLatency}</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{metrics.avgLatencyMs} ms</p>
          <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1 mt-1">
            Sub-second RAG response
          </span>
        </div>

      </div>

      {/* Visual Analytics Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chat Volume by Language (Pie Chart) */}
        <div className="glass-card rounded-2xl p-6 border border-emerald-500/30">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            {t.volumeByLang}
          </h3>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={metrics.languageVolume}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {metrics.languageVolume.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: '#051f18', borderColor: '#10b981', borderRadius: '12px' }} 
                  itemStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div className="flex justify-center gap-4 mt-2">
            {metrics.languageVolume.map((lang) => (
              <div key={lang.name} className="flex items-center gap-2 text-xs text-slate-300 font-medium">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: lang.color }}></span>
                <span>{lang.name} ({lang.value}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ Category Trends (Bar Chart) */}
        <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
            {t.faqTrends}
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.faqTrends} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#1e1b4b', borderColor: '#a855f7', borderRadius: '12px' }} />
                <Bar dataKey="count" fill="#a855f7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Low Confidence Expert Review Queue */}
      <div className="glass-card rounded-2xl p-6 border border-amber-500/30">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{t.reviewQueueTitle}</h3>
              <p className="text-xs text-slate-400">Inspect queries with &lt;75% confidence score to refine AI model</p>
            </div>
          </div>

          <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 text-xs font-bold border border-amber-500/30">
            {reviewQueue.length} Pending
          </span>
        </div>

        {reviewQueue.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            🎉 All low-confidence queries have been reviewed and added to the retraining dataset!
          </div>
        ) : (
          <div className="space-y-4">
            {reviewQueue.map((item) => (
              <div key={item.id} className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                      {item.id}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] uppercase font-bold">
                      {item.language}
                    </span>
                    <span className="text-xs text-slate-400">{item.timestamp}</span>
                  </div>

                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
                    Confidence: {Math.round(item.confidence * 100)}%
                  </span>
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                  {item.photoUrl && (
                    <img src={item.photoUrl} alt="Crop sample" className="w-24 h-24 rounded-xl object-cover border border-amber-500/30 flex-shrink-0" />
                  )}

                  <div className="flex-1 space-y-2">
                    <p className="text-xs font-semibold text-slate-200">Farmer Question:</p>
                    <p className="text-sm text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                      "{item.farmerQuery}"
                    </p>

                    <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                      <input
                        type="text"
                        value={expertAnswers[item.id] || ''}
                        onChange={(e) => setExpertAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder={t.expertAnswerPlaceholder}
                        className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                      />
                      <button
                        onClick={() => handleAnswerSubmit(item.id)}
                        disabled={!expertAnswers[item.id]?.trim()}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{t.submitRetrain}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
