/**
 * retrain_pipeline.js — Continuous Learning & Periodic Model Retraining Pipeline (PDF §5, §9)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. Syncs approved expert corrections + positive-feedback Q&As into
 *    `backend/data/expert_verified_qa.json` and ensures all are indexed in `qa_embeddings`.
 * 2. Exports admin-corrected image diagnoses (`diagnosis_wrong = 1`, `corrected_class`)
 *    into `model/data/retrain/<corrected_class>/` and `model/output/retrain_manifest.json`
 *    so `model/train_cnn.py` can fine-tune on newly collected leaf, fruit, and pest photos.
 * 3. Updates `last_retrain_at` in `kb_meta`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  exportRetrainingDataset,
  getWrongDiagnosisItems,
  getDb,
  setMeta,
} from '../database.js';
import { initEmbeddingEngine, isEmbeddingReady } from '../services/embeddingEngine.js';
import { embedAndStore } from '../services/dataIngestion.js';
import { reloadVectorCache, getCacheSize } from '../services/vectorStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPERT_QA_OUT = path.join(__dirname, '../data/expert_verified_qa.json');
const RETRAIN_IMG_DIR = path.join(__dirname, '../../model/data/retrain');
const RETRAIN_MANIFEST_OUT = path.join(__dirname, '../../model/output/retrain_manifest.json');

export async function runRetrainingPipeline({ ensureEmbedder = false } = {}) {
  initDatabase();
  if (ensureEmbedder && !isEmbeddingReady()) {
    await initEmbeddingEngine();
  }

  const d = getDb();
  const approvedReviews = exportRetrainingDataset();

  // Also gather high-confidence bot answers that received positive (+1) farmer feedback
  const positiveFeedbackPairs = d.prepare(`
    SELECT
      m.id as bot_message_id,
      m.content as answer,
      m.intent as category,
      m.final_confidence,
      c.language,
      (
        SELECT content FROM messages
        WHERE conversation_id = m.conversation_id
          AND sender = 'farmer'
          AND created_at <= m.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) as question
    FROM feedback fb
    JOIN messages m ON fb.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    WHERE fb.rating = 1 AND m.sender = 'bot' AND m.final_confidence >= 0.75
  `).all();

  let newlyEmbedded = 0;
  const verifiedCorpus = [];

  for (const r of approvedReviews) {
    if (!r.original_query || !r.corrected_answer) continue;
    verifiedCorpus.push({
      reviewId: r.review_id,
      question: r.original_query,
      answer: r.corrected_answer,
      language: r.language || 'en',
      category: r.intent || 'expert_correction',
      source: 'expert_correction',
      reviewedAt: r.reviewed_at,
      reviewer: r.reviewer_name || 'Agronomist',
    });

    // Ensure indexed in qa_embeddings if embedder is ready
    const exists = d.prepare('SELECT id FROM qa_embeddings WHERE review_queue_id = ?').get(r.review_id);
    if (!exists && isEmbeddingReady()) {
      const ok = await embedAndStore({
        question: r.original_query,
        answer: r.corrected_answer,
        language: r.language || 'en',
        category: r.intent || 'expert_correction',
        source: 'expert_correction',
        reviewQueueId: r.review_id,
      });
      if (ok) newlyEmbedded++;
    }
  }

  for (const pf of positiveFeedbackPairs) {
    if (!pf.question || !pf.answer) continue;
    verifiedCorpus.push({
      question: pf.question,
      answer: pf.answer,
      language: pf.language || 'en',
      category: pf.category || 'general',
      source: 'positive_feedback',
    });
  }

  fs.mkdirSync(path.dirname(EXPERT_QA_OUT), { recursive: true });
  fs.writeFileSync(EXPERT_QA_OUT, JSON.stringify(verifiedCorpus, null, 2), 'utf-8');

  // Export admin-relabeled images (leaf diseases + fruit/pest/soil labels) for CNN retraining
  const wrongDiagItems = getWrongDiagnosisItems();
  const stagedImages = [];
  fs.mkdirSync(path.dirname(RETRAIN_MANIFEST_OUT), { recursive: true });

  for (const item of wrongDiagItems) {
    const safeClass = String(item.corrected_class || 'unclassified')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const classDir = path.join(RETRAIN_IMG_DIR, safeClass);
    fs.mkdirSync(classDir, { recursive: true });

    let copiedTo = null;
    if (item.image_path && fs.existsSync(item.image_path)) {
      const ext = path.extname(item.image_path) || '.jpg';
      copiedTo = path.join(classDir, `review_${item.id}${ext}`);
      try {
        fs.copyFileSync(item.image_path, copiedTo);
      } catch {
        copiedTo = null;
      }
    }

    stagedImages.push({
      reviewId: item.id,
      originalPrediction: item.cnn_prediction,
      originalConfidence: item.cnn_confidence,
      correctedClass: safeClass,
      sourceImagePath: item.image_path,
      stagedImagePath: copiedTo,
      modelVersion: item.model_version,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    totalVerifiedQaPairs: verifiedCorpus.length,
    approvedExpertReviews: approvedReviews.length,
    positiveFeedbackPairs: positiveFeedbackPairs.length,
    newlyEmbeddedChunks: newlyEmbedded,
    totalRelabeledImages: stagedImages.length,
    relabeledImages: stagedImages,
  };

  fs.writeFileSync(RETRAIN_MANIFEST_OUT, JSON.stringify(manifest, null, 2), 'utf-8');
  setMeta('last_retrain_at', manifest.generatedAt);

  if (newlyEmbedded > 0) {
    reloadVectorCache();
  }

  return {
    ...manifest,
    activeVectorCacheSize: getCacheSize(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runRetrainingPipeline({ ensureEmbedder: true })
    .then((res) => {
      console.log('🔄 Retraining Pipeline Completed (PDF §5, §9):');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('❌ Retraining pipeline failed:', err);
      process.exit(1);
    });
}
