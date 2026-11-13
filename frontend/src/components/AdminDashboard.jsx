import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  LayoutDashboard, ShieldAlert, CheckCircle, Clock, Download,
  Send, Sparkles, MessageSquare, AlertTriangle, FileSpreadsheet,
  RefreshCw, LogOut, XCircle, ThumbsUp, ThumbsDown, Users
} from 'lucide-react';
import { translations } from '../utils/translations';
import {
  getAdminMetrics,
  getPendingReviews,
  submitReview,
  exportRetrainingCsv,
} from '../utils/api';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const LANG_META = {
  mr: { name: 'Marathi (मराठी)', color: '#10b981' },
  hi: { name: 'Hindi (हिंदी)', color: '#a855f7' },
  en: { name: 'English', color: '#3b82f6' },
};

function resolvePhotoUrl(imagePath) {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  const filename = imagePath.split(/[/\\]/).pop();
  return filename ? `${BASE_URL}/uploads/${filename}` : null;
}

export default function AdminDashboard({ currentLang, onAdminLogout }) {
  const t = translations[currentLang];
  const [metrics, setMetrics]             = useState(null);
  const [reviewQueue, setReviewQueue]     = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [expertAnswers, setExpertAnswers] = useState({});
  const [submittingId, setSubmittingId]   = useState(null);
  const [solvedNotice, setSolvedNotice]   = useState(null);

  const loadDashboardData = useCallback(async () => {
    setError(null);
    try {
      const [m, q] = await Promise.all([getAdminMetrics(), getPendingReviews()]);
      setMetrics(m);
      setReviewQueue(q || []);
    } catch (e) {
      console.error('Failed to load admin data', e);
      setError(e.message || 'Failed to load admin dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Handle expert review submission (approve with correctedAnswer or reject)
  const handleReviewAction = async (item, status = 'approved') => {
    const correctedAnswer = (expertAnswers[item.id] ?? item.bot_response ?? '').trim();
    if (status === 'approved' && !correctedAnswer) return;

    setSubmittingId(item.id);
    try {
      await submitReview({
        queueId: item.id,
        correctedAnswer: status === 'approved' ? correctedAnswer : null,
        status,
      });

      // Optimistic removal + live refresh from database
      setReviewQueue(prev => prev.filter(q => q.id !== item.id));
      setSolvedNotice(
        status === 'approved'
          ? `Review #${item.id} approved, saved to SQLite, and indexed into RAG knowledge base!`
          : `Review #${item.id} marked as rejected.`
      );
      setTimeout(() => setSolvedNotice(null), 4000);
      await loadDashboardData();
    } catch (e) {
      setError(`Could not submit review #${item.id}: ${e.message}`);
    } finally {
      setSubmittingId(null);
    }
  };

  // Export JSON / CSV Dataset
  const handleExportDataset = async (format = 'json') => {
    try {
      if (format === 'csv') {
        const blob = await exportRetrainingCsv();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'grape_master_retraining_data.csv';
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        metrics,
        pendingQueue: reviewQueue,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'grape_master_retraining_dataset.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    }
  };

  // ── Loading State ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[calc(100vh-100px)]">
        <div className="w-12 h-12 rounded-full border-3 border-purple-500 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-300">Loading live metrics & review queue...</p>
      </div>
    );
  }

  // Normalize backend metrics for charts & cards
  const totals = metrics?.totals || {};
  const totalQueries = totals.farmer_questions ?? totals.total_messages ?? 0;
  const avgConfidence = totals.avg_confidence ?? 0;
  const pendingCount = metrics?.pendingReviewCount ?? reviewQueue.length ?? 0;
  const avgLatencyMs = totals.avg_latency_ms ?? 0;
  const farmerCount = totals.farmer_count ?? 0;

  const rawLangs = metrics?.languageVolume || [];
  const totalLangConvos = rawLangs.reduce((sum, l) => sum + (l.count || 0), 0);
  const languageChartData = rawLangs.length > 0
    ? rawLangs.map((l) => {
        const meta = LANG_META[l.language] || { name: l.language?.toUpperCase() || 'Other', color: '#64748b' };
        const pct = totalLangConvos > 0 ? Math.round((l.count / totalLangConvos) * 100) : 0;
        return {
          name: meta.name,
          value: pct,
          count: l.count,
          color: meta.color,
        };
      })
    : [
        { name: 'Marathi (मराठी)', value: 0, count: 0, color: '#10b981' },
        { name: 'Hindi (हिंदी)', value: 0, count: 0, color: '#a855f7' },
        { name: 'English', value: 0, count: 0, color: '#3b82f6' },
      ];

  const intentChartData = (metrics?.topIntents || []).map((item) => ({
    category: (item.intent || 'general').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    count: item.count || 0,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

      {/* Header Banner */}
      <div className="glass-card rounded-2xl p-6 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute -left-10 -bottom-10 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/30 flex items-center gap-1">
              <LayoutDashboard className="w-3.5 h-3.5 text-purple-400" /> Admin Control (Live SQLite)
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-semibold border border-emerald-500/30 flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-emerald-400" /> {farmerCount} Farmers
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white">{t.adminTitle}</h2>
          <p className="text-xs text-slate-300 mt-1">{t.adminSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadDashboardData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition-all"
            title="Refresh live data"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" /> Refresh
          </button>
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
          {onAdminLogout && (
            <button
              onClick={onAdminLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold transition-all"
            >
              <LogOut className="w-3.5 h-3.5" /> Admin Sign Out
            </button>
          )}
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

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
          <p className="text-3xl font-extrabold text-white">{totalQueries}</p>
          <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
            {totals.total_conversations ?? 0} total conversations
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-purple-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.avgConfidence}</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{avgConfidence}%</p>
          <span className="text-[10px] text-purple-300 font-medium flex items-center gap-1 mt-1">
            75% escalation threshold
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-amber-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.flaggedQueries}</span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-amber-300">{pendingCount}</p>
          <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1 mt-1">
            {totals.flagged_count ?? 0} total flagged messages
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-blue-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>{t.avgLatency}</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-3xl font-extrabold text-white">{avgLatencyMs} ms</p>
          <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1 mt-1">
            <ThumbsUp className="w-3 h-3 inline" /> {metrics?.feedbackSummary?.positive ?? 0} / <ThumbsDown className="w-3 h-3 inline" /> {metrics?.feedbackSummary?.negative ?? 0} feedback
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
          {totalLangConvos === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-400">
              No conversations recorded yet. Send a farmer chat message to populate language volume.
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={languageChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="count"
                  >
                    {languageChartData.map((entry, index) => (
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
          )}

          <div className="flex flex-wrap justify-center gap-4 mt-2">
            {languageChartData.map((lang) => (
              <div key={lang.name} className="flex items-center gap-2 text-xs text-slate-300 font-medium">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: lang.color }}></span>
                <span>{lang.name} ({lang.count} · {lang.value}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ Category / Intent Trends (Bar Chart) */}
        <div className="glass-card rounded-2xl p-6 border border-purple-500/30">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
            {t.faqTrends}
          </h3>
          {intentChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-400">
              No query intents logged yet.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={intentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <XAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#1e1b4b', borderColor: '#a855f7', borderRadius: '12px' }} />
                  <Bar dataKey="count" fill="#a855f7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
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
              <p className="text-xs text-slate-400">Inspect queries with &lt;75% confidence score or negative farmer feedback</p>
            </div>
          </div>

          <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 text-xs font-bold border border-amber-500/30">
            {reviewQueue.length} Pending
          </span>
        </div>

        {reviewQueue.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            🎉 No flagged items in the review queue right now! All low-confidence queries have been reviewed.
          </div>
        ) : (
          <div className="space-y-4">
            {reviewQueue.map((item) => {
              const photoUrl = resolvePhotoUrl(item.image_path);
              const confPct = Math.round((item.final_confidence ?? 0) * 100);
              const queryText = item.user_query || '(Image-only query)';
              const isBusy = submittingId === item.id;

              return (
                <div key={item.id} className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                        #{item.id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] uppercase font-bold">
                        {item.language || 'en'}
                      </span>
                      {item.cnn_prediction && (
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                          CNN: {item.cnn_prediction}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                      </span>
                    </div>

                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
                      Confidence: {confPct}%
                    </span>
                  </div>

                  <div className="flex flex-col md:flex-row gap-4">
                    {photoUrl && (
                      <img
                        src={photoUrl}
                        alt="Farmer crop upload"
                        className="w-24 h-24 rounded-xl object-cover border border-amber-500/30 flex-shrink-0"
                      />
                    )}

                    <div className="flex-1 space-y-2">
                      <p className="text-xs font-semibold text-slate-200">Farmer Question:</p>
                      <p className="text-sm text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                        "{queryText}"
                      </p>

                      {item.bot_response && (
                        <div className="text-xs text-slate-400 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/70">
                          <span className="font-semibold text-slate-300">Bot Reply: </span>
                          <span className="line-clamp-2">{item.bot_response}</span>
                        </div>
                      )}

                      <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                        <input
                          type="text"
                          value={expertAnswers[item.id] ?? ''}
                          onChange={(e) => setExpertAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder={t.expertAnswerPlaceholder}
                          disabled={isBusy}
                          className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 disabled:opacity-50"
                        />
                        <button
                          onClick={() => handleReviewAction(item, 'approved')}
                          disabled={isBusy || !(expertAnswers[item.id] ?? item.bot_response ?? '').trim()}
                          className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{isBusy ? 'Saving...' : t.submitRetrain}</span>
                        </button>
                        <button
                          onClick={() => handleReviewAction(item, 'rejected')}
                          disabled={isBusy}
                          className="w-full sm:w-auto px-3 py-2 rounded-xl bg-slate-900 hover:bg-red-950/60 border border-slate-700 hover:border-red-500/40 text-slate-300 hover:text-red-300 font-semibold text-xs flex items-center justify-center gap-1 transition-all"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Dismiss</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
