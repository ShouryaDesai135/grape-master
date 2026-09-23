/**
 * apiService.js — Frontend API Contract
 * ═════════════════════════════════════
 * 
 * Drop this file into your React frontend (`src/services/apiService.js`).
 * It provides fully typed, ready-to-use methods for all backend endpoints.
 * 
 * Handles JWT injection, file uploads, and standardizes error responses.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Helper to manage JWT tokens in localStorage
 */
export const TokenManager = {
  getToken: () => localStorage.getItem('grape_master_token'),
  setToken: (token) => localStorage.setItem('grape_master_token', token),
  clearToken: () => localStorage.removeItem('grape_master_token'),
  
  getAuthHeaders: (isMultipart = false) => {
    const token = TokenManager.getToken();
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    // Don't set Content-Type for FormData, the browser sets it with the boundary
    if (!isMultipart) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }
};

/**
 * Base fetch wrapper with error handling
 */
async function fetchApi(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    
    // For CSV exports
    if (response.headers.get('content-type')?.includes('text/csv')) {
      return response.blob();
    }

    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'API Request Failed');
    }
    
    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// FARMER AUTHENTICATION
// ═══════════════════════════════════════════════════════════════

export const AuthService = {
  /**
   * Request an OTP to a phone number.
   * @param {string} phone - e.g. "+919876543210"
   */
  sendOtp: async (phone) => {
    return fetchApi('/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
  },

  /**
   * Verify the OTP and login/signup.
   * @param {string} phone 
   * @param {string} otp 
   * @returns {Object} { token, isNewUser, farmer }
   */
  verifyOtp: async (phone, otp) => {
    const result = await fetchApi('/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });
    if (result.token) TokenManager.setToken(result.token);
    return result;
  },

  /**
   * Admin email/password login.
   */
  adminLogin: async (email, password) => {
    const result = await fetchApi('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (result.token) TokenManager.setToken(result.token);
    return result;
  },

  /**
   * Get current logged-in user profile.
   */
  getProfile: async () => {
    return fetchApi('/auth/me', {
      headers: TokenManager.getAuthHeaders()
    });
  },

  logout: () => {
    TokenManager.clearToken();
  }
};

// ═══════════════════════════════════════════════════════════════
// CHAT & ADVISORY
// ═══════════════════════════════════════════════════════════════

export const ChatService = {
  /**
   * Get all past conversation sessions.
   */
  getConversations: async () => {
    return fetchApi('/conversations', {
      headers: TokenManager.getAuthHeaders()
    });
  },

  /**
   * Get messages for a specific conversation.
   */
  getMessages: async (conversationId) => {
    return fetchApi(`/conversations/${conversationId}/messages`, {
      headers: TokenManager.getAuthHeaders()
    });
  },

  /**
   * Send a message with optional image for diagnosis.
   * @param {string} text - The question text (can be empty if just uploading image)
   * @param {File} imageFile - Native File object from input[type="file"]
   * @param {string} conversationId - (Optional) To continue an existing thread
   */
  sendMessage: async (text, imageFile = null, conversationId = null) => {
    const formData = new FormData();
    if (text) formData.append('text', text);
    if (imageFile) formData.append('image', imageFile);
    if (conversationId) formData.append('conversationId', conversationId);

    return fetchApi('/chat', {
      method: 'POST',
      headers: TokenManager.getAuthHeaders(true),
      body: formData
    });
  },

  /**
   * Submit thumbs up / down feedback for a bot response.
   * @param {string} messageId 
   * @param {number} rating - 1 for helpful, -1 for not helpful
   */
  submitFeedback: async (messageId, rating) => {
    return fetchApi('/feedback', {
      method: 'POST',
      headers: TokenManager.getAuthHeaders(),
      body: JSON.stringify({ messageId, rating })
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

export const AdminService = {
  /**
   * Get overall system metrics and charts.
   */
  getMetrics: async () => {
    return fetchApi('/admin/metrics', {
      headers: TokenManager.getAuthHeaders()
    });
  },

  /**
   * Get flagged queries requiring human review.
   */
  getReviewQueue: async () => {
    return fetchApi('/admin/review-queue', {
      headers: TokenManager.getAuthHeaders()
    });
  },

  /**
   * Submit a human-corrected answer to a flagged query.
   */
  submitReview: async (queueId, correctedAnswer, status = 'approved') => {
    return fetchApi('/admin/review', {
      method: 'POST',
      headers: TokenManager.getAuthHeaders(),
      body: JSON.stringify({ queueId, correctedAnswer, status })
    });
  },

  /**
   * Download the retraining dataset as a CSV Blob.
   */
  exportDataset: async () => {
    const blob = await fetchApi('/admin/export', {
      headers: TokenManager.getAuthHeaders()
    });
    // Trigger download in browser
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grape_master_retraining_data.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};
