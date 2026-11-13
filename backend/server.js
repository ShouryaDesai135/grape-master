/**
 * server.js — Grape Master Production API Gateway
 * ═══════════════════════════════════════════════
 *
 * Express server exposing endpoints for farmer auth, chat,
 * real-time NLP grammar/typo check, feedback, privacy/account management,
 * and admin dashboard + continuous retraining.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// Database & Services
import {
  initDatabase,
  findFarmerById,
  deleteFarmerAndData,
  getConversationsByFarmer,
  getConversationById,
  createConversation,
  insertMessage,
  getMessagesByConversation,
  updateConversationContext,
  updateConversationLanguage,
  updateFarmerPreferences,
  insertFeedback,
  addToReviewQueue,
  getAdminMetrics,
  getPendingReviews,
  getReviewedItems,
  getReviewQueueItem,
  submitReview,
  revokeReview,
  deleteQAByReviewQueueId,
  exportRetrainingDataset,
} from './database.js';
import { verifyFirebaseToken, adminLogin } from './services/authService.js';
import { authenticateFarmer, authenticateAdmin, authenticateAny } from './middleware/authMiddleware.js';
import { initEmbeddingEngine, isEmbeddingReady, EMBEDDING_MODEL } from './services/embeddingEngine.js';
import { ingestPlaceholderData, embedAndStore } from './services/dataIngestion.js';
import { reloadVectorCache, getCacheSize } from './services/vectorStore.js';
import { initLLM, translateTexts, getLLMInfo } from './services/llmSynthesizer.js';
import {
  initVisionEngine,
  analyzeImage,
  validateImageFile,
  isVisionReady,
  isSubjectGateReady,
} from './services/visionEngine.js';
import { processRagQuery } from './services/ragAdvisoryEngine.js';
import { correctGrammarAndSpelling, scrubPii } from './services/nlp.js';
import { isSupportedLanguage, getEnabledLanguages } from './config/languages.js';
import { runRetrainingPipeline } from './scripts/retrain_pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 5000;

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE & SECURITY
// ═══════════════════════════════════════════════════════════════

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME_IN_PRODUCTION' || process.env.JWT_SECRET === 'change_this_to_a_long_random_string') {
    console.error('❌ FATAL: JWT_SECRET must be set to a strong secret in production.');
    process.exit(1);
  }
}

app.use(helmet({ crossOriginResourcePolicy: false }));
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : (process.env.NODE_ENV === 'production' ? [] : '*');
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '1mb' }));

// Rate Limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 250 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
app.use('/api/', apiLimiter);

// File Uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: (process.env.MAX_IMAGE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});
app.use('/uploads', express.static(UPLOADS_DIR));

// ═══════════════════════════════════════════════════════════════
// HEALTH & READINESS PROBES (PDF §9 & §10)
// ═══════════════════════════════════════════════════════════════

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', (_req, res) => {
  const ready = isEmbeddingReady() && getCacheSize() > 0;
  res.status(ready ? 200 : 503).json({
    ready,
    embeddingEngine: { ready: isEmbeddingReady(), model: EMBEDDING_MODEL },
    vectorStore: { chunksLoaded: getCacheSize() },
    visionEngine: { leafCnnReady: isVisionReady(), clipSubjectGateReady: isSubjectGateReady() },
    llm: getLLMInfo(),
  });
});

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATION & PRIVACY ENDPOINTS
// ═══════════════════════════════════════════════════════════════

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
  if (req.user.type === 'farmer') {
    const farmer = findFarmerById(req.user.id);
    if (farmer) {
      return res.json({
        success: true,
        user: {
          ...req.user,
          preferredLanguage: farmer.preferred_language,
          region: farmer.region,
          variety: farmer.variety,
          pruningType: farmer.pruning_type,
          pruningDate: farmer.pruning_date,
          consentGiven: Boolean(farmer.consent_given),
        },
      });
    }
  }
  res.json({ success: true, user: req.user });
});

app.patch('/api/auth/preferences', authenticateFarmer, (req, res) => {
  const { preferredLanguage, region, variety, pruningType, pruningDate, consentGiven } = req.body || {};
  if (preferredLanguage && !isSupportedLanguage(preferredLanguage)) {
    return res.status(400).json({ success: false, error: 'Unsupported language' });
  }
  updateFarmerPreferences(req.user.id, {
    preferredLanguage,
    region,
    variety,
    pruningType,
    pruningDate,
    consentGiven,
  });
  const updated = findFarmerById(req.user.id);
  res.json({
    success: true,
    preferences: {
      preferredLanguage: updated?.preferred_language || preferredLanguage || 'en',
      region: updated?.region || null,
      variety: updated?.variety || null,
      pruningType: updated?.pruning_type || null,
      pruningDate: updated?.pruning_date || null,
      consentGiven: Boolean(updated?.consent_given),
    },
  });
});

/**
 * DELETE /api/auth/account
 * Data Privacy Right-to-Erasure (PDF §10): deletes farmer profile, conversations,
 * messages, feedback, and removes uploaded leaf/crop photos from disk.
 */
app.delete('/api/auth/account', authenticateFarmer, (req, res) => {
  const imagePaths = deleteFarmerAndData(req.user.id);
  let deletedFiles = 0;
  for (const imgPath of imagePaths) {
    if (imgPath && fs.existsSync(imgPath)) {
      try {
        fs.unlinkSync(imgPath);
        deletedFiles++;
      } catch { /* ignore */ }
    }
  }
  res.json({ success: true, deletedImages: deletedFiles });
});

// ═══════════════════════════════════════════════════════════════
// FARMER: CHAT, NLP & ADVISORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/conversations', authenticateFarmer, (req, res) => {
  const convos = getConversationsByFarmer(req.user.id);
  res.json({ success: true, conversations: convos });
});

app.get('/api/conversations/:id/messages', authenticateFarmer, (req, res) => {
  const convo = getConversationById(req.params.id);
  if (!convo || convo.farmer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  const messages = getMessagesByConversation(convo.id);
  res.json({ success: true, messages, language: convo.language });
});

app.get('/api/languages', (_req, res) => {
  res.json({ success: true, languages: getEnabledLanguages() });
});

/**
 * POST /api/nlp/check
 * Real-time deterministic spelling, typo, and grammatical error check while typing (PDF §4).
 */
app.post('/api/nlp/check', (req, res) => {
  const { text = '', language = 'en' } = req.body || {};
  if (typeof text !== 'string' || text.length > 1000) {
    return res.status(400).json({ success: false, error: 'Invalid text input' });
  }
  const result = correctGrammarAndSpelling(text, language);
  res.json({ success: true, ...result });
});

app.patch('/api/conversations/:id/language', authenticateFarmer, (req, res) => {
  const { language } = req.body;
  if (!isSupportedLanguage(language)) {
    return res.status(400).json({ success: false, error: 'Unsupported language.' });
  }
  const convo = getConversationById(req.params.id);
  if (!convo || convo.farmer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  updateConversationLanguage(convo.id, language);
  updateFarmerPreferences(req.user.id, { preferredLanguage: language });
  res.json({ success: true, language });
});

app.post('/api/translate', authenticateFarmer, async (req, res) => {
  try {
    const { texts, targetLanguage } = req.body;
    if (!isSupportedLanguage(targetLanguage)) {
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
    const preferredLang = isSupportedLanguage(language) ? language : 'en';
    let convoId = conversationId;
    let convo = null;
    let cnnResult = null;
    const imagePath = req.file ? req.file.path : null;

    if (!text && !imagePath) {
      return res.status(400).json({ success: false, error: 'Text or image is required' });
    }

    // Validate image magic bytes before saving or running inference
    if (imagePath) {
      const check = await validateImageFile(imagePath);
      if (!check.valid) {
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
        return res.status(400).json({ success: false, error: check.error });
      }
    }

    // 1. Resolve or Create Conversation
    if (convoId) {
      convo = getConversationById(convoId);
      if (!convo || convo.farmer_id !== req.user.id) {
        if (imagePath) { try { fs.unlinkSync(imagePath); } catch { /* ignore */ } }
        return res.status(403).json({ success: false, error: 'Invalid conversation' });
      }
    } else {
      convoId = uuidv4();
      createConversation({
        id: convoId,
        farmerId: req.user.id,
        title: text ? scrubPii(text).substring(0, 40) : 'Image Diagnosis',
        language: preferredLang,
      });
      convo = getConversationById(convoId);
    }

    // 2. Save Farmer's Message (PII-scrubbed for privacy compliance)
    const safeText = scrubPii(text || '');
    const farmerMsgId = uuidv4();
    insertMessage({
      id: farmerMsgId,
      conversationId: convoId,
      sender: 'farmer',
      content: safeText,
      imagePath,
    });

    // 3. Image Analysis (CLIP Subject Gate + 7-class Leaf CNN)
    if (imagePath) {
      cnnResult = await analyzeImage(imagePath);
    }

    // 4. Build Farmer Vineyard Context from profile
    const farmer = findFarmerById(req.user.id);
    let daysAfterPruning = null;
    if (farmer?.pruning_date) {
      const diff = Date.now() - new Date(farmer.pruning_date).getTime();
      if (!Number.isNaN(diff) && diff >= 0) {
        daysAfterPruning = Math.floor(diff / (1000 * 60 * 60 * 24));
      }
    }
    const farmerContext = {
      region: farmer?.region || null,
      variety: farmer?.variety || null,
      pruningType: farmer?.pruning_type || null,
      daysAfterPruning,
    };

    // 5. Run Hybrid RAG Pipeline
    const context = JSON.parse(convo.canonical_context || '{"turns":[]}');
    const ragResult = await processRagQuery(safeText, context.turns || [], cnnResult, preferredLang, farmerContext);

    // 6. Save Bot's Message
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
      responseTimeMs: ragResult.responseTimeMs,
      modelVersion: cnnResult?.modelVersion || null,
      cnnAlternatives: cnnResult?.alternatives || null,
    });

    // 7. Canonical context preserves meaning across language switches
    context.turns.push({ role: 'farmer', canonical: ragResult.correctedQuery || safeText || 'Uploaded image', language: ragResult.language });
    context.turns.push({ role: 'bot', canonical: ragResult.answer, confidence: ragResult.finalConfidence, language: ragResult.language });
    updateConversationContext(convoId, context, ragResult.language);

    // 8. Auto-flag for review if low confidence
    if (ragResult.isFlagged) {
      addToReviewQueue({ messageId: botMsgId });
    }

    // 9. Return combined response
    res.json({
      success: true,
      conversationId: convoId,
      messageId: botMsgId,
      answer: ragResult.answer,
      diagnosis: cnnResult,
      confidence: ragResult.finalConfidence,
      ragConfidence: ragResult.ragConfidence,
      imageConfidence: ragResult.imageConfidence,
      correctedQuery: ragResult.correctedQuery,
      hasNlpChanges: ragResult.hasNlpChanges,
      nlpCorrections: ragResult.nlpCorrections,
      isFlagged: ragResult.isFlagged,
      language: ragResult.language,
      intent: ragResult.intent,
    });
  } catch (error) {
    console.error('❌ Chat API Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/feedback', authenticateFarmer, (req, res) => {
  const { messageId, rating, comment } = req.body;
  const numericRating = parseInt(rating, 10);
  if (![-1, 1].includes(numericRating)) {
    return res.status(400).json({ success: false, error: 'Rating must be 1 or -1' });
  }
  insertFeedback({ messageId, farmerId: req.user.id, rating: numericRating, comment: comment || null });

  if (numericRating === -1) {
    addToReviewQueue({ messageId });
  }

  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/admin/metrics', authenticateAdmin(), (_req, res) => {
  res.json({ success: true, metrics: getAdminMetrics() });
});

app.get('/api/admin/review-queue', authenticateAdmin(), (_req, res) => {
  res.json({ success: true, queue: getPendingReviews() });
});

app.get('/api/admin/reviewed', authenticateAdmin(), (_req, res) => {
  res.json({ success: true, reviewed: getReviewedItems(100) });
});

app.post('/api/admin/review', authenticateAdmin(), async (req, res) => {
  const queueId = req.body.queueId || req.body.id;
  const correctedAnswer = req.body.correctedAnswer;
  const status = req.body.status || (req.body.approved === false ? 'rejected' : 'approved');
  const rejectReason = req.body.rejectReason || null;
  const diagnosisWrong = Boolean(req.body.diagnosisWrong);
  const correctedClass = req.body.correctedClass || null;

  if (!queueId) {
    return res.status(400).json({ success: false, error: 'queueId is required' });
  }
  const queueItem = getReviewQueueItem(queueId);
  submitReview({
    queueId,
    correctedAnswer,
    reviewedBy: req.user.id,
    status,
    rejectReason,
    diagnosisWrong,
    correctedClass,
  });

  // Continuous learning loop: index approved expert corrections into qa_embeddings immediately
  if (status === 'approved' && correctedAnswer && correctedAnswer.trim() && queueItem?.user_query) {
    try {
      const embedded = await embedAndStore({
        question: queueItem.user_query,
        answer: correctedAnswer.trim(),
        language: queueItem.language || 'en',
        category: 'expert_correction',
        source: 'expert_correction',
        reviewQueueId: Number(queueId),
      });
      if (embedded) reloadVectorCache();
    } catch (err) {
      console.error('⚠️ Could not embed expert correction:', err.message);
    }
  }

  res.json({ success: true, status });
});

/**
 * POST /api/admin/review/:id/revoke
 * Revoke a previously approved review and remove its vector from qa_embeddings.
 */
app.post('/api/admin/review/:id/revoke', authenticateAdmin(), (req, res) => {
  const queueId = Number(req.params.id);
  if (!queueId) {
    return res.status(400).json({ success: false, error: 'Valid review ID is required' });
  }
  revokeReview({ queueId, reviewedBy: req.user.id });
  deleteQAByReviewQueueId(queueId);
  reloadVectorCache();
  res.json({ success: true, revokedId: queueId, activeChunks: getCacheSize() });
});

/**
 * POST /api/admin/retrain
 * Trigger periodic retraining sync (merges expert corrections + positive feedback & stages CNN images).
 */
app.post('/api/admin/retrain', authenticateAdmin(), async (_req, res) => {
  try {
    const summary = await runRetrainingPipeline({ ensureEmbedder: true });
    res.json({ success: true, summary });
  } catch (err) {
    console.error('❌ Retrain API Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/export', authenticateAdmin(['admin', 'expert']), (_req, res) => {
  const data = exportRetrainingDataset();
  res.header('Content-Type', 'text/csv; charset=utf-8');
  res.attachment('grape_master_retraining_data.csv');

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['review_id', 'original_query', 'language', 'cnn_prediction', 'diagnosis_wrong', 'corrected_class', 'final_confidence', 'intent', 'corrected_answer', 'reviewer_name', 'reviewed_at'].join(',');
  const rows = data.map((r) => [
    r.review_id,
    esc(r.original_query),
    esc(r.language),
    esc(r.cnn_prediction),
    r.diagnosis_wrong ? 1 : 0,
    esc(r.corrected_class),
    r.final_confidence ?? '',
    esc(r.intent),
    esc(r.corrected_answer),
    esc(r.reviewer_name),
    esc(r.reviewed_at),
  ].join(',')).join('\n');

  res.send(`\uFEFF${headers}\n${rows}`);
});

// ═══════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════

export async function initializeApp() {
  initDatabase();
  initLLM();
  await initEmbeddingEngine();
  await ingestPlaceholderData();
  await initVisionEngine();
}

async function startServer() {
  console.log('🚀 Starting Grape Master API Server...');
  await initializeApp();

  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`──────────────────────────────────────────────────`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
