/**
 * database.js — Production Database Engine for Grape Master
 * ══════════════════════════════════════════════════════════
 * 
 * 7-Entity Normalized Schema:
 * ┌──────────────┐     ┌───────────────┐     ┌──────────┐
 * │   FARMER     │────▶│ CONVERSATION  │────▶│ MESSAGE  │
 * │ (Firebase)   │     │ (multi-turn)  │     │ (content)│
 * └──────────────┘     └───────────────┘     └────┬─────┘
 *                                                 │
 *                            ┌────────────────────┼────────────────┐
 *                            ▼                    ▼                ▼
 *                     ┌──────────┐     ┌──────────────────┐  ┌────────────┐
 *                     │ FEEDBACK │     │ REVIEW_QUEUE_ITEM│  │ QA_EMBEDDING│
 *                     │ (👍/👎) │     │ (expert review)  │  │ (RAG corpus)│
 *                     └──────────┘     └──────────────────┘  └────────────┘
 *                                              ▲
 *                                       ┌──────┴──────┐
 *                                       │    ADMIN     │
 *                                       │ (email+JWT)  │
 *                                       └─────────────┘
 * 
 * WHY SQLITE:
 * - Zero-config, file-based — no separate database server to install
 * - WAL mode enables concurrent reads during writes
 * - Perfect for single-instance deployment (per PRD §9)
 * - Can be swapped to PostgreSQL for multi-instance scaling
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'grape_master.db');

let db;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

export function initDatabase() {
  db = new Database(DB_PATH);

  // WAL mode: allows concurrent reads while writing — critical for
  // a production web server where API requests arrive simultaneously
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  createIndexes();

  console.log('✅ Database initialized:', DB_PATH);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

function createTables() {
  // ─── 1. FARMERS ──────────────────────────────────────────────
  // Created on first successful Firebase Auth verification.
  // firebase_uid is the unique identifier from Firebase.
  // Supports Email/Password and Google Sign-In flows.
  db.exec(`
    CREATE TABLE IF NOT EXISTS farmers (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      region TEXT,
      photo_url TEXT,
      consent_given INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── 2. ADMINS ───────────────────────────────────────────────
  // Pre-provisioned by seed script or existing admin.
  // NO public signup — PRD §2 mandates this.
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'expert',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── 3. REFRESH TOKENS ──────────────────────────────────────
  // Stores refresh token metadata for session management.
  // Actual auth is handled by Firebase; this tracks active sessions.
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE CASCADE
    )
  `);

  // ─── 4. CONVERSATIONS ───────────────────────────────────────
  // One per chat session. Stores multi-turn context in a
  // language-independent canonical form so the farmer can switch
  // language mid-conversation without losing context (PRD §4.2).
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      farmer_id TEXT NOT NULL,
      title TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      canonical_context TEXT DEFAULT '{"turns":[]}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE CASCADE
    )
  `);

  // ─── 5. MESSAGES ─────────────────────────────────────────────
  // The core content unit. Every farmer question and bot response
  // is a message. Image uploads attach to messages via image_path.
  // CNN and RAG confidence scores are stored separately for
  // diagnostic analysis in the admin dashboard.
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('farmer', 'bot')),
      content TEXT,
      image_path TEXT,
      cnn_prediction TEXT,
      cnn_confidence REAL,
      rag_confidence REAL,
      final_confidence REAL,
      is_flagged INTEGER DEFAULT 0,
      intent TEXT,
      response_time_ms INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // ─── 6. FEEDBACK ─────────────────────────────────────────────
  // One rating per farmer per bot message (enforced by UNIQUE).
  // rating: 1 = helpful (👍), -1 = not helpful (👎)
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      farmer_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating IN (-1, 1)),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE CASCADE,
      UNIQUE(message_id, farmer_id)
    )
  `);

  // ─── 7. REVIEW QUEUE ────────────────────────────────────────
  // Auto-populated when confidence < threshold or farmer gives 👎.
  // Admins review, write corrected answers, approve/reject.
  // Approved corrections feed back into the QA embedding corpus.
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      corrected_answer TEXT,
      reviewed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES admins(id)
    )
  `);

  // ─── 8. QA EMBEDDINGS (RAG Corpus) ──────────────────────────
  // The retrieval knowledge base. Each row is a question-answer
  // pair with its vector embedding for similarity search.
  // Sources: 'placeholder' (our 30 QAs), 'sponsor' (future dataset),
  // 'expert_correction' (from admin review approvals).
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      category TEXT,
      vector BLOB,
      source TEXT DEFAULT 'placeholder',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function createIndexes() {
  // Performance indexes for common query patterns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_farmers_firebase_uid ON farmers(firebase_uid)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_farmers_email ON farmers(email)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email)`);
  // (otp_store table removed — auth is now handled by Firebase)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_farmer ON conversations(farmer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_msg_flagged ON messages(is_flagged)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_msg ON feedback(message_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_lang ON qa_embeddings(language)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_category ON qa_embeddings(category)`);
}

// ═══════════════════════════════════════════════════════════════
// FARMER OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function findFarmerByFirebaseUid(firebaseUid) {
  return getDb().prepare('SELECT * FROM farmers WHERE firebase_uid = ?').get(firebaseUid);
}

export function findFarmerByEmail(email) {
  return getDb().prepare('SELECT * FROM farmers WHERE email = ?').get(email);
}

export function findFarmerById(id) {
  return getDb().prepare('SELECT * FROM farmers WHERE id = ?').get(id);
}

export function createFarmer({ id, firebaseUid, name, email, preferredLanguage = 'en', region = null, photoUrl = null }) {
  return getDb().prepare(`
    INSERT INTO farmers (id, firebase_uid, name, email, preferred_language, region, photo_url, consent_given)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, firebaseUid, name, email, preferredLanguage, region, photoUrl);
}

export function updateFarmerPreferences(farmerId, { preferredLanguage, region, consentGiven, name, photoUrl }) {
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (preferredLanguage !== undefined) { updates.push('preferred_language = ?'); params.push(preferredLanguage); }
  if (region !== undefined) { updates.push('region = ?'); params.push(region); }
  if (consentGiven !== undefined) { updates.push('consent_given = ?'); params.push(consentGiven ? 1 : 0); }
  if (photoUrl !== undefined) { updates.push('photo_url = ?'); params.push(photoUrl); }
  if (updates.length === 0) return;
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(farmerId);
  return getDb().prepare(`UPDATE farmers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

// ═══════════════════════════════════════════════════════════════
// ADMIN OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function findAdminByEmail(email) {
  return getDb().prepare('SELECT * FROM admins WHERE email = ?').get(email);
}

export function findAdminById(id) {
  return getDb().prepare('SELECT * FROM admins WHERE id = ?').get(id);
}

export function createAdmin({ id, email, passwordHash, fullName, role = 'expert' }) {
  return getDb().prepare(`
    INSERT INTO admins (id, email, password_hash, full_name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email, passwordHash, fullName, role);
}

// ═══════════════════════════════════════════════════════════════
// (OTP OPERATIONS REMOVED — Auth is now handled by Firebase)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// CONVERSATION OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function createConversation({ id, farmerId, title = null, language = 'en' }) {
  return getDb().prepare(`
    INSERT INTO conversations (id, farmer_id, title, language)
    VALUES (?, ?, ?, ?)
  `).run(id, farmerId, title, language);
}

export function getConversationsByFarmer(farmerId, limit = 50) {
  return getDb().prepare(`
    SELECT c.*, 
      (SELECT content FROM messages WHERE conversation_id = c.id AND sender = 'farmer' ORDER BY created_at ASC LIMIT 1) as first_message,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
    FROM conversations c
    WHERE c.farmer_id = ?
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(farmerId, limit);
}

export function getConversationById(conversationId) {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
}

export function updateConversationContext(conversationId, canonicalContext, language) {
  return getDb().prepare(`
    UPDATE conversations 
    SET canonical_context = ?, language = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(canonicalContext), language, conversationId);
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function insertMessage({ id, conversationId, sender, content, imagePath = null, cnnPrediction = null, cnnConfidence = null, ragConfidence = null, finalConfidence = null, isFlagged = false, intent = null, responseTimeMs = 0 }) {
  return getDb().prepare(`
    INSERT INTO messages (id, conversation_id, sender, content, image_path, cnn_prediction, cnn_confidence, rag_confidence, final_confidence, is_flagged, intent, response_time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, conversationId, sender, content, imagePath, cnnPrediction, cnnConfidence, ragConfidence, finalConfidence, isFlagged ? 1 : 0, intent, responseTimeMs);
}

export function getMessagesByConversation(conversationId) {
  return getDb().prepare(`
    SELECT m.*, 
      (SELECT rating FROM feedback WHERE message_id = m.id LIMIT 1) as feedback_rating,
      (SELECT status FROM review_queue WHERE message_id = m.id LIMIT 1) as review_status
    FROM messages m
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(conversationId);
}

export function getMessageById(messageId) {
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
}

// ═══════════════════════════════════════════════════════════════
// FEEDBACK OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function insertFeedback({ messageId, farmerId, rating, comment = null }) {
  return getDb().prepare(`
    INSERT OR REPLACE INTO feedback (message_id, farmer_id, rating, comment)
    VALUES (?, ?, ?, ?)
  `).run(messageId, farmerId, rating, comment);
}

// ═══════════════════════════════════════════════════════════════
// REVIEW QUEUE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function addToReviewQueue({ messageId }) {
  // Don't add duplicates
  const existing = getDb().prepare('SELECT id FROM review_queue WHERE message_id = ?').get(messageId);
  if (existing) return existing;
  return getDb().prepare(`
    INSERT INTO review_queue (message_id) VALUES (?)
  `).run(messageId);
}

export function getPendingReviews(limit = 50) {
  return getDb().prepare(`
    SELECT rq.*, 
      m.content as original_content,
      m.image_path,
      m.cnn_prediction,
      m.final_confidence,
      m.intent,
      m.created_at as message_created_at,
      c.language,
      f.phone as farmer_phone,
      f.region as farmer_region,
      (SELECT content FROM messages WHERE conversation_id = m.conversation_id AND sender = 'bot' AND created_at >= m.created_at ORDER BY created_at ASC LIMIT 1) as bot_response
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    JOIN farmers f ON c.farmer_id = f.id
    WHERE rq.status = 'pending'
    ORDER BY rq.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function submitReview({ queueId, correctedAnswer, reviewedBy, status = 'approved' }) {
  return getDb().prepare(`
    UPDATE review_queue
    SET corrected_answer = ?, reviewed_by = ?, status = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(correctedAnswer, reviewedBy, status, queueId);
}

export function getReviewedItems(limit = 500) {
  return getDb().prepare(`
    SELECT rq.*, m.content as original_query, m.final_confidence,
      c.language
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    WHERE rq.status IN ('approved', 'rejected')
    ORDER BY rq.reviewed_at DESC
    LIMIT ?
  `).all(limit);
}

// ═══════════════════════════════════════════════════════════════
// QA EMBEDDING OPERATIONS (RAG Corpus)
// ═══════════════════════════════════════════════════════════════

export function insertQAEmbedding({ question, answer, language, category, vector, source = 'placeholder' }) {
  return getDb().prepare(`
    INSERT INTO qa_embeddings (question, answer, language, category, vector, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(question, answer, language, category, vector, source);
}

export function getAllQAEmbeddings() {
  return getDb().prepare('SELECT * FROM qa_embeddings').all();
}

export function getQAEmbeddingsByLanguage(language) {
  return getDb().prepare('SELECT * FROM qa_embeddings WHERE language = ?').all(language);
}

export function clearQAEmbeddings(source = null) {
  if (source) {
    return getDb().prepare('DELETE FROM qa_embeddings WHERE source = ?').run(source);
  }
  return getDb().prepare('DELETE FROM qa_embeddings').run();
}

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD METRICS
// ═══════════════════════════════════════════════════════════════

export function getAdminMetrics() {
  const d = getDb();

  const totals = d.prepare(`
    SELECT 
      COUNT(*) as total_messages,
      COUNT(DISTINCT conversation_id) as total_conversations,
      ROUND(AVG(CASE WHEN sender = 'bot' THEN final_confidence END) * 100, 1) as avg_confidence,
      SUM(CASE WHEN is_flagged = 1 THEN 1 ELSE 0 END) as flagged_count,
      ROUND(AVG(CASE WHEN sender = 'bot' THEN response_time_ms END), 0) as avg_latency_ms
    FROM messages
  `).get();

  const languageVolume = d.prepare(`
    SELECT language, COUNT(*) as count
    FROM conversations
    GROUP BY language
    ORDER BY count DESC
  `).all();

  const dailyVolume = d.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM messages
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  const pendingReviewCount = d.prepare(`
    SELECT COUNT(*) as count FROM review_queue WHERE status = 'pending'
  `).get();

  const topIntents = d.prepare(`
    SELECT intent, COUNT(*) as count
    FROM messages
    WHERE sender = 'farmer' AND intent IS NOT NULL
    GROUP BY intent
    ORDER BY count DESC
    LIMIT 10
  `).all();

  const confidenceTrend = d.prepare(`
    SELECT DATE(created_at) as date, 
      ROUND(AVG(final_confidence) * 100, 1) as avg_confidence
    FROM messages
    WHERE sender = 'bot' AND created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  const feedbackSummary = d.prepare(`
    SELECT 
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative,
      COUNT(*) as total
    FROM feedback
  `).get();

  return {
    totals,
    languageVolume,
    dailyVolume,
    pendingReviewCount: pendingReviewCount.count,
    topIntents,
    confidenceTrend,
    feedbackSummary
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA EXPORT (for model retraining)
// ═══════════════════════════════════════════════════════════════

export function exportRetrainingDataset() {
  return getDb().prepare(`
    SELECT 
      m.content as original_query,
      c.language,
      m.cnn_prediction,
      m.final_confidence,
      m.intent,
      rq.corrected_answer,
      rq.status,
      rq.reviewed_at,
      a.full_name as reviewer_name
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN admins a ON rq.reviewed_by = a.id
    WHERE rq.status = 'approved'
    ORDER BY rq.reviewed_at DESC
  `).all();
}

export function getFarmerCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM farmers').get().count;
}
