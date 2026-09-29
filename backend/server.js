/**
 * server.js — Grape Master Production API Gateway
 * ═══════════════════════════════════════════════
 * 
 * Express server exposing endpoints for farmer auth, chat, 
 * feedback, and admin dashboard. Initializes all ML models
 * (CNN + MiniLM) on startup.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// Database & Services
import { initDatabase, getConversationsByFarmer, getConversationById, createConversation, insertMessage, getMessagesByConversation, updateConversationContext, updateConversationLanguage, updateFarmerPreferences, insertFeedback, addToReviewQueue, getAdminMetrics, getPendingReviews, submitReview, exportRetrainingDataset } from './database.js';
import { verifyFirebaseToken, adminLogin } from './services/authService.js';
import { authenticateFarmer, authenticateAdmin, authenticateAny } from './middleware/authMiddleware.js';
import { initEmbeddingEngine } from './services/embeddingEngine.js';
import { ingestPlaceholderData } from './services/dataIngestion.js';
import { initLLM, translateTexts } from './services/llmSynthesizer.js';
import { initVisionEngine, analyzeImage } from './services/visionEngine.js';
import { processRagQuery } from './services/ragAdvisoryEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE & SECURITY
// ═══════════════════════════════════════════════════════════════

app.use(helmet({ crossOriginResourcePolicy: false })); // Allow serving static images locally
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*' }));
app.use(express.json());

// Rate Limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
app.use('/api/', apiLimiter);

// File Uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads/'),
  limits: { fileSize: (process.env.MAX_IMAGE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/auth/firebase-verify
 * 
 * The frontend calls this after the user signs in via Firebase
 * (Email/Password or Google). It sends the Firebase ID Token here.
 * We verify it, create the farmer record if new, and return our own JWT.
 * 
 * Body: { idToken: string, preferredLanguage?: 'en'|'hi'|'mr' }
 */
app.post('/api/auth/firebase-verify', authLimiter, async (req, res) => {
  const { idToken, preferredLanguage, name } = req.body;
  const result = await verifyFirebaseToken(idToken, preferredLanguage || 'en', name);
  res.status(result.success ? 200 : 401).json(result);
});

app.post('/api/admin/login', authLimiter, async (req, res) => {
  const result = await adminLogin(req.body.email, req.body.password);
  res.status(result.success ? 200 : 401).json(result);
});

app.get('/api/auth/me', authenticateAny, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ═══════════════════════════════════════════════════════════════
// FARMER: CHAT & ADVISORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// Get all conversations for a farmer
app.get('/api/conversations', authenticateFarmer, (req, res) => {
  const convos = getConversationsByFarmer(req.user.id);
  res.json({ success: true, conversations: convos });
});

// Get messages for a specific conversation
app.get('/api/conversations/:id/messages', authenticateFarmer, (req, res) => {
  const convo = getConversationById(req.params.id);
  if (!convo || convo.farmer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  const messages = getMessagesByConversation(convo.id);
  res.json({ success: true, messages, language: convo.language });
});

// Mid-session language switch — keeps canonical_context intact
app.patch('/api/conversations/:id/language', authenticateFarmer, (req, res) => {
  const { language } = req.body;
  if (!['en', 'hi', 'mr'].includes(language)) {
    return res.status(400).json({ success: false, error: 'Unsupported language. Use en, hi, or mr.' });
  }
  const convo = getConversationById(req.params.id);
  if (!convo || convo.farmer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  updateConversationLanguage(convo.id, language);
  updateFarmerPreferences(req.user.id, { preferredLanguage: language });
  res.json({ success: true, language });
});

app.patch('/api/auth/preferences', authenticateFarmer, (req, res) => {
  const { preferredLanguage, region } = req.body;
  if (preferredLanguage && !['en', 'hi', 'mr'].includes(preferredLanguage)) {
    return res.status(400).json({ success: false, error: 'Unsupported language' });
  }
  updateFarmerPreferences(req.user.id, { preferredLanguage, region });
  res.json({ success: true, preferredLanguage, region });
});

/**
 * POST /api/translate
 * Gemini-powered authentic translation for dynamic farmer-facing text.
 * Body: { texts: string[], targetLanguage: 'en'|'hi'|'mr' }
 */
app.post('/api/translate', authenticateFarmer, async (req, res) => {
  try {
    const { texts, targetLanguage } = req.body;
    if (!['en', 'hi', 'mr'].includes(targetLanguage)) {
      return res.status(400).json({ success: false, error: 'Unsupported language' });
    }
    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ success: false, error: 'texts array is required' });
    }
    if (texts.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 texts per request' });
    }
    const translations = await translateTexts(texts.slice(0, 20), targetLanguage);
    res.json({ success: true, translations, language: targetLanguage });
  } catch (error) {
    console.error('❌ Translate API Error:', error);
    res.status(500).json({ success: false, error: 'Translation failed' });
  }
});

// Send a new message (text and/or image)
app.post('/api/chat', authenticateFarmer, upload.single('image'), async (req, res) => {
  try {
    const { text, conversationId, language } = req.body;
    const preferredLang = ['en', 'hi', 'mr'].includes(language) ? language : 'en';
    let convoId = conversationId;
    let convo = null;
    let cnnResult = null;
    const imagePath = req.file ? req.file.path : null;

    if (!text && !imagePath) {
      return res.status(400).json({ success: false, error: 'Text or image is required' });
    }

    // 1. Resolve or Create Conversation
    if (convoId) {
      convo = getConversationById(convoId);
      if (!convo || convo.farmer_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Invalid conversation' });
      }
    } else {
      convoId = uuidv4();
      createConversation({
        id: convoId,
        farmerId: req.user.id,
        title: text ? text.substring(0, 30) : 'Image Diagnosis',
        language: preferredLang,
      });
      convo = getConversationById(convoId);
    }

    // 2. Save Farmer's Message
    const farmerMsgId = uuidv4();
    insertMessage({
      id: farmerMsgId,
      conversationId: convoId,
      sender: 'farmer',
      content: text || '',
      imagePath
    });

    // 3. Image Analysis (if uploaded)
    if (imagePath) {
      cnnResult = await analyzeImage(imagePath);
    }

    // 4. RAG — explicit UI language wins so mid-session switches are respected
    const context = JSON.parse(convo.canonical_context || '{"turns":[]}');
    const ragResult = await processRagQuery(text || '', context.turns || [], cnnResult, preferredLang);

    // 5. Save Bot's Message
    const botMsgId = uuidv4();
    insertMessage({
      id: botMsgId,
      conversationId: convoId,
      sender: 'bot',
      content: ragResult.answer,
      cnnPrediction: cnnResult ? cnnResult.prediction : null,
      cnnConfidence: cnnResult ? cnnResult.confidence : null,
      ragConfidence: ragResult.ragConfidence,
      finalConfidence: ragResult.finalConfidence,
      isFlagged: ragResult.isFlagged,
      intent: ragResult.intent,
      responseTimeMs: ragResult.responseTimeMs
    });

    // 6. Canonical context preserves meaning across language switches
    context.turns.push({ role: 'farmer', canonical: text || 'Uploaded image', language: preferredLang });
    context.turns.push({ role: 'bot', canonical: ragResult.answer, confidence: ragResult.finalConfidence, language: ragResult.language });
    updateConversationContext(convoId, context, preferredLang);

    // 7. Auto-flag for review if low confidence
    if (ragResult.isFlagged) {
      addToReviewQueue({ messageId: botMsgId });
    }

    // 8. Return combined response
    res.json({
      success: true,
      conversationId: convoId,
      messageId: botMsgId,
      answer: ragResult.answer,
      diagnosis: cnnResult,
      confidence: ragResult.finalConfidence,
      isFlagged: ragResult.isFlagged,
      language: ragResult.language
    });

  } catch (error) {
    console.error('❌ Chat API Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/feedback', authenticateFarmer, (req, res) => {
  const { messageId, rating } = req.body;
  insertFeedback({ messageId, farmerId: req.user.id, rating: parseInt(rating, 10) });
  
  if (parseInt(rating, 10) === -1) {
    addToReviewQueue({ messageId }); // Auto-flag downvoted answers
  }
  
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/admin/metrics', authenticateAdmin(), (req, res) => {
  res.json({ success: true, metrics: getAdminMetrics() });
});

app.get('/api/admin/review-queue', authenticateAdmin(), (req, res) => {
  res.json({ success: true, queue: getPendingReviews() });
});

app.post('/api/admin/review', authenticateAdmin(), (req, res) => {
  const queueId = req.body.queueId || req.body.id;
  const correctedAnswer = req.body.correctedAnswer;
  const status = req.body.status || (req.body.approved === false ? 'rejected' : 'approved');
  if (!queueId) {
    return res.status(400).json({ success: false, error: 'queueId is required' });
  }
  submitReview({ queueId, correctedAnswer, reviewedBy: req.user.id, status });
  res.json({ success: true });
});

app.get('/api/admin/export', authenticateAdmin(['admin']), (req, res) => {
  const data = exportRetrainingDataset();
  res.header('Content-Type', 'text/csv');
  res.attachment('grape_master_retraining_data.csv');
  
  const headers = ['original_query', 'language', 'cnn_prediction', 'final_confidence', 'intent', 'corrected_answer', 'reviewer_name', 'reviewed_at'].join(',');
  const rows = data.map(r => `"${r.original_query || ''}","${r.language}","${r.cnn_prediction || ''}",${r.final_confidence},"${r.intent || ''}","${r.corrected_answer || ''}","${r.reviewer_name || ''}","${r.reviewed_at}"`).join('\n');
  
  res.send(`${headers}\n${rows}`);
});

// ═══════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════

async function startServer() {
  console.log('🚀 Starting Grape Master API Server...');
  initDatabase();
  initLLM();
  await initEmbeddingEngine();
  await ingestPlaceholderData();
  await initVisionEngine();

  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`──────────────────────────────────────────────────`);
  });
}

startServer();
