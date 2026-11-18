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

// DB_PATH env var lets tests run against an isolated database file.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'grape_master.db');

let db;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

export function initDatabase() {
  if (db) return db; // idempotent: safe to call from tests and server
  db = new Database(DB_PATH);

  // WAL mode: allows concurrent reads while writing — critical for
  // a production web server where API requests arrive simultaneously
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  runMigrations();
  createIndexes();

  console.log('✅ Database initialized:', DB_PATH);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/** Add a column only if it does not exist yet (SQLite has no IF NOT EXISTS for columns). */
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations() {
  // Key/value store (embedding model version, calibration coefficients, ...)
  db.exec(`CREATE TABLE IF NOT EXISTS kb_meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Farmer context used to filter retrieval (variety, pruning stage)
  addColumnIfMissing('farmers', 'variety', 'TEXT');
  addColumnIfMissing('farmers', 'pruning_type', 'TEXT');
  addColumnIfMissing('farmers', 'pruning_date', 'TEXT');

  // Model traceability + "which diagnosis was wrong" for retraining exports
  addColumnIfMissing('messages', 'model_version', 'TEXT');
  addColumnIfMissing('messages', 'cnn_alternatives', 'TEXT');
  addColumnIfMissing('review_queue', 'reject_reason', 'TEXT');
  addColumnIfMissing('review_queue', 'diagnosis_wrong', 'INTEGER DEFAULT 0');
  addColumnIfMissing('review_queue', 'corrected_class', 'TEXT');
  addColumnIfMissing('review_queue', 'revoked_at', 'DATETIME');

  // Retrieval metadata (variety / growth stage / reviewer provenance)
  addColumnIfMissing('qa_embeddings', 'meta', 'TEXT');
  addColumnIfMissing('qa_embeddings', 'review_queue_id', 'INTEGER');

  // At most one queue row per bot message (best effort if legacy duplicates exist)
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_review_message ON review_queue(message_id)`);
  } catch {
    console.warn('⚠️ Could not create unique review_queue index (legacy duplicates present).');
  }
}

export function getMeta(key) {
  return getDb().prepare('SELECT value FROM kb_meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(key, value) {
  getDb()
    .prepare('INSERT INTO kb_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
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

export function updateFarmerPreferences(farmerId, { preferredLanguage, region, consentGiven, name, photoUrl, variety, pruningType, pruningDate }) {
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (preferredLanguage !== undefined) { updates.push('preferred_language = ?'); params.push(preferredLanguage); }
  if (region !== undefined) { updates.push('region = ?'); params.push(region); }
  if (consentGiven !== undefined) { updates.push('consent_given = ?'); params.push(consentGiven ? 1 : 0); }
  if (photoUrl !== undefined) { updates.push('photo_url = ?'); params.push(photoUrl); }
  if (variety !== undefined) { updates.push('variety = ?'); params.push(variety); }
  if (pruningType !== undefined) { updates.push('pruning_type = ?'); params.push(pruningType); }
  if (pruningDate !== undefined) { updates.push('pruning_date = ?'); params.push(pruningDate); }
  if (updates.length === 0) return;
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(farmerId);
  return getDb().prepare(`UPDATE farmers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Delete a farmer and everything they own (conversations, messages, feedback via
 * ON DELETE CASCADE). Returns uploaded image paths so the caller can remove files.
 */
export function deleteFarmerAndData(farmerId) {
  const d = getDb();
  const images = d.prepare(`
    SELECT m.image_path FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.farmer_id = ? AND m.image_path IS NOT NULL
  `).all(farmerId).map((r) => r.image_path);
  d.prepare('DELETE FROM farmers WHERE id = ?').run(farmerId);
  return images;
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
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
      (SELECT ROUND(AVG(final_confidence) * 100) FROM messages WHERE conversation_id = c.id AND sender = 'bot' AND final_confidence IS NOT NULL) as avg_confidence,
      (SELECT MAX(is_flagged) FROM messages WHERE conversation_id = c.id) as has_flagged
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

export function updateConversationLanguage(conversationId, language) {
  return getDb().prepare(`
    UPDATE conversations
    SET language = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(language, conversationId);
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function insertMessage({ id, conversationId, sender, content, imagePath = null, cnnPrediction = null, cnnConfidence = null, ragConfidence = null, finalConfidence = null, isFlagged = false, intent = null, responseTimeMs = 0, modelVersion = null, cnnAlternatives = null }) {
  return getDb().prepare(`
    INSERT INTO messages (id, conversation_id, sender, content, image_path, cnn_prediction, cnn_confidence, rag_confidence, final_confidence, is_flagged, intent, response_time_ms, model_version, cnn_alternatives)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, conversationId, sender, content, imagePath, cnnPrediction, cnnConfidence, ragConfidence, finalConfidence,
    isFlagged ? 1 : 0, intent, responseTimeMs, modelVersion,
    cnnAlternatives ? JSON.stringify(cnnAlternatives) : null
  );
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
  // Flagged message_id points at the bot reply; farmer query and image_path are on the prior farmer turn.
  return getDb().prepare(`
    SELECT rq.*,
      m.content as bot_response,
      COALESCE(
        m.image_path,
        (
          SELECT image_path FROM messages
          WHERE conversation_id = m.conversation_id
            AND sender = 'farmer'
            AND created_at <= m.created_at
            AND image_path IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        )
      ) as image_path,
      m.cnn_prediction,
      m.cnn_alternatives,
      m.final_confidence,
      m.intent,
      m.created_at as message_created_at,
      c.language,
      f.name as farmer_name,
      f.email as farmer_email,
      f.region as farmer_region,
      f.variety as farmer_variety,
      (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND sender = 'farmer'
          AND created_at <= m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) as user_query
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    JOIN farmers f ON c.farmer_id = f.id
    WHERE rq.status = 'pending'
    ORDER BY rq.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function submitReview({ queueId, correctedAnswer, reviewedBy, status = 'approved', rejectReason = null, diagnosisWrong = false, correctedClass = null }) {
  return getDb().prepare(`
    UPDATE review_queue
    SET corrected_answer = ?, reviewed_by = ?, status = ?, reviewed_at = CURRENT_TIMESTAMP,
        reject_reason = ?, diagnosis_wrong = ?, corrected_class = ?
    WHERE id = ?
  `).run(correctedAnswer ?? null, reviewedBy, status, rejectReason, diagnosisWrong ? 1 : 0, correctedClass, queueId);
}

/**
 * Revoke a previously approved correction. The CHECK constraint on `status` only allows
 * pending/approved/rejected, so a revoked review becomes `rejected` with revoked_at set.
 */
export function revokeReview({ queueId, reviewedBy }) {
  return getDb().prepare(`
    UPDATE review_queue
    SET status = 'rejected', reject_reason = 'revoked', revoked_at = CURRENT_TIMESTAMP,
        reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'approved'
  `).run(reviewedBy, queueId);
}

/** Items whose image diagnosis was wrong - source for CNN retraining exports (Phase 10.2). */
export function getWrongDiagnosisItems() {
  return getDb().prepare(`
    SELECT rq.id, rq.corrected_class, m.cnn_prediction, m.cnn_confidence, m.image_path, m.model_version
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    WHERE rq.diagnosis_wrong = 1 AND rq.status = 'approved' AND rq.corrected_class IS NOT NULL
  `).all();
}

export function getReviewQueueItem(queueId) {
  return getDb().prepare(`
    SELECT rq.*, m.content as bot_response, c.language,
      (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND sender = 'farmer'
          AND created_at <= m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) as user_query
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    WHERE rq.id = ?
  `).get(queueId);
}

export function getReviewedItems(limit = 500) {
  return getDb().prepare(`
    SELECT rq.*,
      m.content as bot_response,
      COALESCE(
        (
          SELECT content FROM messages
          WHERE conversation_id = m.conversation_id
            AND sender = 'farmer'
            AND created_at <= m.created_at
          ORDER BY created_at DESC
          LIMIT 1
        ),
        ''
      ) as user_query,
      m.cnn_prediction,
      m.final_confidence,
      c.language,
      f.region as farmer_region
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN farmers f ON c.farmer_id = f.id
    WHERE rq.status IN ('approved', 'rejected')
    ORDER BY rq.reviewed_at DESC
    LIMIT ?
  `).all(limit);
}

// ═══════════════════════════════════════════════════════════════
// QA EMBEDDING OPERATIONS (RAG Corpus)
// ═══════════════════════════════════════════════════════════════

export function insertQAEmbedding({ question, answer, language, category, vector, source = 'placeholder', meta = null, reviewQueueId = null }) {
  return getDb().prepare(`
    INSERT INTO qa_embeddings (question, answer, language, category, vector, source, meta, review_queue_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(question, answer, language, category, vector, source, meta ? JSON.stringify(meta) : null, reviewQueueId);
}

/** Remove the knowledge-base entry created from a given review (used by "revoke"). */
export function deleteQAByReviewQueueId(reviewQueueId) {
  return getDb().prepare('DELETE FROM qa_embeddings WHERE review_queue_id = ?').run(reviewQueueId);
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
      ROUND(AVG(CASE WHEN sender = 'bot' THEN response_time_ms END), 0) as avg_latency_ms,
      SUM(CASE WHEN sender = 'bot' THEN 1 ELSE 0 END) as bot_replies,
      SUM(CASE WHEN sender = 'farmer' THEN 1 ELSE 0 END) as farmer_questions
    FROM messages
  `).get();

  const farmerCount = d.prepare(`SELECT COUNT(*) as count FROM farmers`).get().count;

  const languageVolume = d.prepare(`
    SELECT language, COUNT(*) as count
    FROM conversations
    GROUP BY language
    ORDER BY count DESC
  `).all();

  const dailyVolume = d.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM messages
    WHERE sender = 'farmer' AND created_at >= datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  const pendingReviewCount = d.prepare(`
    SELECT COUNT(*) as count FROM review_queue WHERE status = 'pending'
  `).get();

  const topIntents = d.prepare(`
    SELECT COALESCE(intent, 'general') as intent, COUNT(*) as count
    FROM messages
    WHERE sender = 'bot' AND intent IS NOT NULL AND intent != ''
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

  const topQuestions = d.prepare(`
    SELECT
      m.content as question,
      COALESCE(bot.intent, 'general') as intent,
      c.language,
      COALESCE(NULLIF(TRIM(f.region), ''), 'Maharashtra (General)') as region,
      COUNT(*) as asked,
      ROUND(AVG(bot.final_confidence) * 100, 1) as avg_confidence
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN farmers f ON c.farmer_id = f.id
    LEFT JOIN messages bot ON bot.conversation_id = m.conversation_id
      AND bot.sender = 'bot'
      AND bot.created_at >= m.created_at
      AND bot.id = (
        SELECT id FROM messages
        WHERE conversation_id = m.conversation_id
          AND sender = 'bot'
          AND created_at >= m.created_at
        ORDER BY created_at ASC
        LIMIT 1
      )
    WHERE m.sender = 'farmer' AND LENGTH(TRIM(m.content)) > 3
    GROUP BY LOWER(TRIM(m.content)), c.language, COALESCE(NULLIF(TRIM(f.region), ''), 'Maharashtra (General)')
    ORDER BY asked DESC, avg_confidence DESC
    LIMIT 30
  `).all();

  // Per-language response accuracy & confidence metrics (PDF §7 bullet 3)
  const languageAccuracy = d.prepare(`
    SELECT
      c.language,
      COUNT(m.id) as bot_replies,
      ROUND(AVG(m.final_confidence) * 100, 1) as avg_confidence,
      ROUND(AVG(CASE WHEN m.final_confidence >= 0.75 THEN 100.0 ELSE 0.0 END), 1) as high_confidence_pct,
      SUM(CASE WHEN fb.rating = 1 THEN 1 ELSE 0 END) as positive_feedback,
      SUM(CASE WHEN fb.rating = -1 THEN 1 ELSE 0 END) as negative_feedback
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN feedback fb ON fb.message_id = m.id
    WHERE m.sender = 'bot'
    GROUP BY c.language
    ORDER BY bot_replies DESC
  `).all();

  const totalFeedback = feedbackSummary?.total || 0;
  const posFeedback = feedbackSummary?.positive || 0;
  const helpfulnessRatePct = totalFeedback > 0 ? Number(((posFeedback / totalFeedback) * 100).toFixed(1)) : null;

  const botRepliesCount = totals?.bot_replies || 0;
  const flaggedCount = totals?.flagged_count || 0;
  const autoResolvedRatePct = botRepliesCount > 0
    ? Number((((botRepliesCount - flaggedCount) / botRepliesCount) * 100).toFixed(1))
    : 100;

  const kbChunkCount = d.prepare(`SELECT COUNT(*) as count FROM qa_embeddings`).get().count;

  const recentPending = d.prepare(`
    SELECT rq.id,
      m.final_confidence,
      c.language,
      rq.created_at,
      (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND sender = 'farmer'
          AND created_at <= m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) as user_query
    FROM review_queue rq
    JOIN messages m ON rq.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    WHERE rq.status = 'pending'
    ORDER BY rq.created_at DESC
    LIMIT 5
  `).all();

  return {
    totals: {
      ...totals,
      farmer_count: farmerCount,
      kb_chunk_count: kbChunkCount,
      last_retrain_at: getMeta('last_retrain_at'),
    },
    languageVolume,
    dailyVolume,
    pendingReviewCount: pendingReviewCount.count,
    topIntents,
    confidenceTrend,
    feedbackSummary,
    accuracyMetrics: {
      helpfulnessRatePct,
      autoResolvedRatePct,
      avgConfidencePct: totals?.avg_confidence ?? 0,
      byLanguage: languageAccuracy,
    },
    topQuestions,
    faqsByRegionAndLanguage: topQuestions,
    recentPending,
    recentReviewed: getReviewedItems(20),
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA EXPORT (for model retraining)
// ═══════════════════════════════════════════════════════════════

export function exportRetrainingDataset() {
  return getDb().prepare(`
    SELECT 
      rq.id as review_id,
      COALESCE(
        (
          SELECT content FROM messages
          WHERE conversation_id = m.conversation_id
            AND sender = 'farmer'
            AND created_at <= m.created_at
          ORDER BY created_at DESC
          LIMIT 1
        ),
        ''
      ) as original_query,
      COALESCE(
        m.image_path,
        (
          SELECT image_path FROM messages
          WHERE conversation_id = m.conversation_id
            AND sender = 'farmer'
            AND created_at <= m.created_at
            AND image_path IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        )
      ) as image_path,
      m.content as bot_response,
      c.language,
      m.cnn_prediction,
      m.final_confidence,
      m.intent,
      rq.corrected_answer,
      rq.diagnosis_wrong,
      rq.corrected_class,
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
