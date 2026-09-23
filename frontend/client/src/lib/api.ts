/**
 * api.ts — Grape Master API Client
 * ════════════════════════════════════════
 * Axios instance configured with automatic auth token attachment,
 * base URL configuration, and type-safe API helper methods.
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auto-attach JWT session token from localStorage to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Response interceptor for auth token handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

/* ─────────────────────────────────────────────────────────────────
 * API HELPER METHODS
 * ───────────────────────────────────────────────────────────────── */

// Auth
export async function verifyFirebaseToken(idToken: string, name?: string) {
  const res = await api.post('/api/auth/firebase-verify', { idToken, name });
  return res.data;
}

export async function requestOTP(phone: string) {
  const res = await api.post('/api/auth/otp/send', { phone });
  return res.data;
}

export async function verifyOTP(phone: string, otp: string) {
  const res = await api.post('/api/auth/otp/verify', { phone, otp });
  return res.data;
}

// Conversations & Chat
export async function getConversations() {
  const res = await api.get('/api/conversations');
  return res.data;
}

export async function getConversationMessages(conversationId: string) {
  const res = await api.get(`/api/conversations/${conversationId}/messages`);
  return res.data;
}

export async function sendChatMessage(formData: FormData) {
  const res = await api.post('/api/chat', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return res.data;
}

export async function submitFeedback(messageId: string, rating: number, feedbackText?: string) {
  const res = await api.post('/api/feedback', { messageId, rating, feedbackText });
  return res.data;
}

// Admin Dashboard
export async function getAdminMetrics() {
  const res = await api.get('/api/admin/metrics');
  return res.data;
}

export async function getReviewQueue() {
  const res = await api.get('/api/admin/review-queue');
  return res.data;
}

export async function submitReviewAction(id: string, correctedAnswer: string, approved: boolean) {
  const res = await api.post('/api/admin/review', { id, correctedAnswer, approved });
  return res.data;
}
