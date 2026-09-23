/**
 * api.js — Axios Client for Grape Master Backend
 * ════════════════════════════════════════════════
 * Attaches the JWT token (stored in localStorage after firebase-verify)
 * to every request automatically via a request interceptor.
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // 30s — LLM calls can take time
});

// ── Request interceptor: attach JWT bearer token ──────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gm_jwt');
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
export async function verifyFirebaseToken(idToken, preferredLanguage = 'en') {
  const res = await api.post('/api/auth/firebase-verify', { idToken, preferredLanguage });
  if (res.data.success && res.data.token) {
    localStorage.setItem('gm_jwt', res.data.token);
  }
  return res.data;
}

export function clearJWT() {
  localStorage.removeItem('gm_jwt');
}

// ── Chat helpers ──────────────────────────────────────────────────

/**
 * Send a chat message (text + optional image file) to the backend.
 * Returns { answer, diagnosis, confidence, conversationId, ... }
 */
export async function sendChatMessage({ text, imageFile, conversationId }) {
  const formData = new FormData();
  if (text)           formData.append('text', text);
  if (conversationId) formData.append('conversationId', conversationId);
  if (imageFile)      formData.append('image', imageFile);

  const res = await api.post('/api/chat', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
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

export async function getReviewQueue() {
  const res = await api.get('/api/admin/review-queue');
  return res.data.queue || [];
}

export async function submitReview({ queueId, correctedAnswer, status }) {
  const res = await api.post('/api/admin/review', { queueId, correctedAnswer, status });
  return res.data;
}
