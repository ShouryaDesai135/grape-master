/**
 * api.js — Axios Client for Grape Master Backend
 * ════════════════════════════════════════════════
 * Attaches the farmer JWT (`gm_jwt`) or admin JWT (`gm_admin_jwt`)
 * to every request automatically via a request interceptor.
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // 30s — LLM calls can take time
});

// ── Token helpers ─────────────────────────────────────────────────

export function getFarmerToken() {
  return localStorage.getItem('gm_jwt');
}

export function clearJWT() {
  localStorage.removeItem('gm_jwt');
}

export function setAdminToken(token) {
  localStorage.setItem('gm_admin_jwt', token);
}

export function getAdminToken() {
  return localStorage.getItem('gm_admin_jwt');
}

export function clearAdminToken() {
  localStorage.removeItem('gm_admin_jwt');
}

// ── Request interceptor: attach appropriate JWT bearer token ──────
api.interceptors.request.use((config) => {
  const isAdminRoute = config.url?.startsWith('/api/admin');
  const token = isAdminRoute ? getAdminToken() : getFarmerToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: surface error messages cleanly ──────────
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.error || err.message || 'Network error — is the backend running?';
    return Promise.reject(new Error(message));
  }
);

// ── Auth helpers ──────────────────────────────────────────────────

/**
 * Exchange a Firebase ID token for our own backend JWT.
 * Also stores the JWT in localStorage for subsequent requests.
 */
export async function verifyFirebaseToken(idToken, preferredLanguage = 'en', name = null) {
  const res = await api.post('/api/auth/firebase-verify', { idToken, preferredLanguage, name });
  if (res.data.success && res.data.token) {
    localStorage.setItem('gm_jwt', res.data.token);
  }
  return res.data;
}

/**
 * Authenticate an admin/expert account against POST /api/admin/login.
 * Stores the returned JWT under `gm_admin_jwt` (separate from farmer token).
 */
export async function adminLogin(email, password) {
  const res = await api.post('/api/admin/login', { email, password });
  if (res.data?.token) {
    setAdminToken(res.data.token);
  }
  return res.data;
}

// ── Chat & Multilingual helpers ───────────────────────────────────

/**
 * Send a chat message (text + optional image file + active UI language) to the backend.
 * Returns { answer, diagnosis, confidence, conversationId, ... }
 */
export async function sendChatMessage({ text, imageFile, conversationId, language }) {
  const formData = new FormData();
  if (text)           formData.append('text', text);
  if (conversationId) formData.append('conversationId', conversationId);
  if (imageFile)      formData.append('image', imageFile);
  if (language)       formData.append('language', language);

  const res = await api.post('/api/chat', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

/**
 * Update the active language for an existing conversation (mid-session switch).
 */
export async function updateConversationLanguage(conversationId, language) {
  const res = await api.patch(`/api/conversations/${conversationId}/language`, { language });
  return res.data;
}

/**
 * Update farmer preferences (preferredLanguage, region).
 */
export async function updatePreferences({ preferredLanguage, region }) {
  const res = await api.patch('/api/auth/preferences', { preferredLanguage, region });
  return res.data;
}

/**
 * Translate an array of dynamic strings into targetLanguage ('en'|'hi'|'mr') via Gemini.
 */
export async function translateTexts(texts, targetLanguage) {
  const res = await api.post('/api/translate', { texts, targetLanguage });
  return res.data.translations;
}

/**
 * Real-time grammar, spelling & typo check for farmer chat input while typing.
 */
export async function checkQueryNlp(text, language = 'en') {
  const res = await api.post('/api/nlp/check', { text, language });
  return res.data;
}

/**
 * Submit feedback for a bot message (+1 helpful, -1 not helpful).
 */
export async function submitFeedback(messageId, rating) {
  const res = await api.post('/api/feedback', { messageId, rating });
  return res.data;
}

/**
 * Load all conversations for the logged-in farmer.
 */
export async function getConversations() {
  const res = await api.get('/api/conversations');
  return res.data.conversations || [];
}

/**
 * Load messages for a specific conversation.
 */
export async function getConversationMessages(conversationId) {
  const res = await api.get(`/api/conversations/${conversationId}/messages`);
  return res.data;
}

// ── Admin helpers ─────────────────────────────────────────────────

export async function getAdminMetrics() {
  const res = await api.get('/api/admin/metrics');
  return res.data.metrics;
}

export async function getPendingReviews() {
  const res = await api.get('/api/admin/review-queue');
  return res.data.queue || [];
}

// Alias for backwards compatibility
export const getReviewQueue = getPendingReviews;

export async function submitReview({ queueId, correctedAnswer, status }) {
  const res = await api.post('/api/admin/review', { queueId, correctedAnswer, status });
  return res.data;
}

export async function exportRetrainingCsv() {
  const res = await api.get('/api/admin/export', { responseType: 'blob' });
  return res.data;
}
