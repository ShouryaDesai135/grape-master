/**
 * dataIngestion.js — Knowledge Base Chunking & Indexing
 * ═════════════════════════════════════════════════════
 * 
 * Reads the placeholder_qa.json dataset (or future sponsor datasets),
 * embeds each question-answer pair, and stores it in SQLite.
 * Designed to be idempotent (safe to run multiple times).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearQAEmbeddings, insertQAEmbedding } from '../database.js';
import { generateEmbedding, float32ArrayToBuffer } from './embeddingEngine.js';
import { reloadVectorCache } from './vectorStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLACEHOLDER_DATA_PATH = path.join(__dirname, '../data/placeholder_qa.json');

/**
 * Ingest the placeholder dataset.
 * Clears existing placeholder data, embeds new rows, and reloads the vector cache.
 */
export async function ingestPlaceholderData() {
  console.log('📚 Starting data ingestion from placeholder_qa.json...');
  
  if (!fs.existsSync(PLACEHOLDER_DATA_PATH)) {
    console.warn('⚠️ placeholder_qa.json not found. Skipping ingestion.');
    return;
  }

  const rawData = fs.readFileSync(PLACEHOLDER_DATA_PATH, 'utf-8');
  let qaList;
  try {
    qaList = JSON.parse(rawData);
  } catch (err) {
    console.error('❌ Error parsing placeholder_qa.json:', err);
    return;
  }

  // Clear old placeholder data to prevent duplicates
  clearQAEmbeddings('placeholder');
  let ingestedCount = 0;

  for (const item of qaList) {
    const category = item.category || 'general';

    // We embed the combination of Question + Answer so the vector
    // captures the full semantic meaning of the chunk.
    
    // 1. English
    if (item.question_en && item.answer_en) {
      const textToEmbed = `Question: ${item.question_en}\nAnswer: ${item.answer_en}`;
      const vector = await generateEmbedding(textToEmbed);
      if (vector) {
        insertQAEmbedding({
          question: item.question_en,
          answer: item.answer_en,
          language: 'en',
          category,
          vector: float32ArrayToBuffer(vector),
          source: 'placeholder'
        });
        ingestedCount++;
      }
    }

    // 2. Hindi
    if (item.question_hi && item.answer_hi) {
      const textToEmbed = `प्रश्न: ${item.question_hi}\nउत्तर: ${item.answer_hi}`;
      const vector = await generateEmbedding(textToEmbed);
      if (vector) {
        insertQAEmbedding({
          question: item.question_hi,
          answer: item.answer_hi,
          language: 'hi',
          category,
          vector: float32ArrayToBuffer(vector),
          source: 'placeholder'
        });
        ingestedCount++;
      }
    }

    // 3. Marathi
    if (item.question_mr && item.answer_mr) {
      const textToEmbed = `प्रश्न: ${item.question_mr}\nउत्तर: ${item.answer_mr}`;
      const vector = await generateEmbedding(textToEmbed);
      if (vector) {
        insertQAEmbedding({
          question: item.question_mr,
          answer: item.answer_mr,
          language: 'mr',
          category,
          vector: float32ArrayToBuffer(vector),
          source: 'placeholder'
        });
        ingestedCount++;
      }
    }
  }

  console.log(`✅ Ingested ${ingestedCount} embedded chunks into database.`);
  
  // Reload the fast in-memory search cache
  reloadVectorCache();
}
