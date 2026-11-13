/**
 * dataIngestion.js — Knowledge Base Chunking & Indexing
 * ═════════════════════════════════════════════════════
 *
 * Ingests placeholder Q&A pairs and the structured grape_dataset.json
 * (diseases + advisory FAQs) into multilingual embedding chunks.
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearQAEmbeddings, insertQAEmbedding, getAllQAEmbeddings, getMeta, setMeta, getDb } from '../database.js';
import { generateEmbedding, float32ArrayToBuffer, EMBEDDING_MODEL, isEmbeddingReady } from './embeddingEngine.js';
import { reloadVectorCache } from './vectorStore.js';
import { normalizeText } from './nlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLACEHOLDER_DATA_PATH = path.join(__dirname, '../data/placeholder_qa.json');
const GRAPE_DATASET_PATH = path.join(__dirname, '../data/grape_dataset.json');
const FARMER_QA_PATH = path.join(__dirname, '../data/farmer_qa_cleaned.json');

const LANGS = ['en', 'hi', 'mr'];

// Bump when the text that gets embedded changes, to force a re-embed of the whole KB.
const EMBEDDING_STRATEGY = 'question+answer200-v2';

/**
 * Embed a Q&A pair and store it. The question carries most of the retrieval signal, and
 * multilingual MiniLM only reads ~128 tokens, so we embed the question plus a short answer snippet.
 */
export async function embedAndStore({ question, answer, language, category, source, meta = null, reviewQueueId = null }) {
  if (!question || !answer) return false;
  const q = normalizeText(question);
  const snippet = normalizeText(answer).slice(0, 200);
  const vector = await generateEmbedding(`${q}\n${snippet}`);
  if (!vector) return false;
  insertQAEmbedding({
    question,
    answer,
    language,
    category,
    vector: float32ArrayToBuffer(vector),
    source,
    meta,
    reviewQueueId,
  });
  return true;
}

/**
 * Ingest flat Q&A list (placeholder_qa.json shape).
 */
async function ingestFlatQaList(qaList, source) {
  let count = 0;
  for (const item of qaList) {
    const category = item.category || 'general';
    if (item.question_en && item.answer_en) {
      if (await embedAndStore({ question: item.question_en, answer: item.answer_en, language: 'en', category, source })) count++;
    }
    if (item.question_hi && item.answer_hi) {
      if (await embedAndStore({ question: item.question_hi, answer: item.answer_hi, language: 'hi', category, source })) count++;
    }
    if (item.question_mr && item.answer_mr) {
      if (await embedAndStore({ question: item.question_mr, answer: item.answer_mr, language: 'mr', category, source })) count++;
    }
  }
  return count;
}

/**
 * Expand structured disease entries into searchable Q&A chunks per language.
 */
function diseaseToQaPairs(disease) {
  const name = disease.name || {};
  const pairs = [];

  for (const lang of LANGS) {
    const diseaseName = name[lang] || name.en || disease.id;
    const symptoms = disease.symptoms?.[lang] || disease.symptoms?.en;
    const cause = disease.cause?.[lang] || disease.cause?.en;
    const organic = disease.organic?.[lang] || disease.organic?.en;
    const chemical = disease.chemical?.[lang] || disease.chemical?.en;
    const precautions = disease.precautions?.[lang] || disease.precautions?.en;

    const qSymptoms = {
      en: `What are the symptoms of ${name.en || disease.id}?`,
      hi: `${name.hi || name.en} के लक्षण क्या हैं?`,
      mr: `${name.mr || name.en} ची लक्षणे कोणती आहेत?`,
    };
    const qCause = {
      en: `What causes ${name.en || disease.id}?`,
      hi: `${name.hi || name.en} किस कारण से होता है?`,
      mr: `${name.mr || name.en} कशामुळे होतो?`,
    };
    const qTreat = {
      en: `How do I treat ${name.en || disease.id} on grape vines?`,
      hi: `${name.hi || name.en} का इलाज कैसे करें?`,
      mr: `${name.mr || name.en} वर कसा उपचार करावा?`,
    };
    const qPrevent = {
      en: `How can I prevent ${name.en || disease.id}?`,
      hi: `${name.hi || name.en} से कैसे बचाव करें?`,
      mr: `${name.mr || name.en} पासून कसे बचाव करावे?`,
    };

    if (symptoms) {
      pairs.push({ language: lang, category: 'disease', question: qSymptoms[lang], answer: `${diseaseName}: ${symptoms}` });
    }
    if (cause) {
      pairs.push({ language: lang, category: 'disease', question: qCause[lang], answer: cause });
    }
    if (organic || chemical) {
      const treatmentParts = [];
      if (organic) treatmentParts.push(lang === 'en' ? `Organic: ${organic}` : lang === 'hi' ? `जैविक: ${organic}` : `सेंद्रिय: ${organic}`);
      if (chemical) treatmentParts.push(lang === 'en' ? `Chemical: ${chemical}` : lang === 'hi' ? `रासायनिक: ${chemical}` : `रासायनिक: ${chemical}`);
      pairs.push({ language: lang, category: 'disease', question: qTreat[lang], answer: treatmentParts.join('\n\n') });
    }
    if (precautions) {
      pairs.push({ language: lang, category: 'disease', question: qPrevent[lang], answer: precautions });
    }
  }

  return pairs;
}

async function ingestGrapeDataset(existingBySource = {}) {
  if (!fs.existsSync(GRAPE_DATASET_PATH)) {
    console.warn('⚠️ grape_dataset.json not found. Skipping structured KB ingestion.');
    return 0;
  }

  let dataset;
  try {
    dataset = JSON.parse(fs.readFileSync(GRAPE_DATASET_PATH, 'utf-8'));
  } catch (err) {
    console.error('❌ Error parsing grape_dataset.json:', err);
    return 0;
  }

  const allPairs = [];
  for (const disease of dataset.diseases || []) {
    for (const pair of diseaseToQaPairs(disease)) {
      allPairs.push(pair);
    }
  }
  for (const faq of dataset.advisoryFAQs || []) {
    const category = faq.category || 'general';
    for (const lang of LANGS) {
      const question = faq.question?.[lang] || faq.question?.en;
      const answer = faq.answer?.[lang] || faq.answer?.en;
      if (question && answer) {
        allPairs.push({ question, answer, language: lang, category });
      }
    }
  }

  const dsHash = fileHash(GRAPE_DATASET_PATH);
  if (existingBySource['grape_dataset'] === allPairs.length && allPairs.length > 0 && getMeta('hash:grape_dataset') === dsHash) {
    return allPairs.length;
  }

  clearQAEmbeddings('grape_dataset');
  let count = 0;
  for (const pair of allPairs) {
    if (await embedAndStore({ ...pair, source: 'grape_dataset' })) count++;
  }
  setMeta('hash:grape_dataset', dsHash);

  return count;
}

async function ingestFarmerQaDataset(existingBySource = {}) {
  if (!fs.existsSync(FARMER_QA_PATH)) {
    return 0;
  }

  let qaItems;
  try {
    qaItems = JSON.parse(fs.readFileSync(FARMER_QA_PATH, 'utf-8'));
  } catch (err) {
    console.error('❌ Error parsing farmer_qa_cleaned.json:', err);
    return 0;
  }

  const validItems = (qaItems || []).filter((item) => item.question && item.answer);
  const hash = fileHash(FARMER_QA_PATH);
  if (existingBySource['farmer_qa'] === validItems.length && validItems.length > 0 && getMeta('hash:farmer_qa') === hash) {
    return validItems.length;
  }

  clearQAEmbeddings('farmer_qa');
  let count = 0;

  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const ok = await embedAndStore({
      question: item.question,
      answer: item.answer,
      language: item.language || 'mr',
      category: item.category || 'general',
      source: 'farmer_qa',
      meta: { variety: item.variety || null, stage: item.stage || null },
    });
    if (ok) count++;
    if ((i + 1) % 250 === 0 || i + 1 === validItems.length) {
      console.log(`    ... embedded ${i + 1}/${validItems.length} farmer Q&A pairs`);
    }
  }
  setMeta('hash:farmer_qa', hash);

  return count;
}

function fileHash(p) {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch { return 'missing'; }
}

/**
 * Full knowledge-base ingest: placeholder QAs + structured grape dataset + cleaned real farmer QAs.
 * Skips re-embedding a source when its file hash and chunk count are unchanged.
 * If the embedding model or embedding strategy changed, EVERYTHING (incl. expert corrections) is re-embedded.
 */
export async function ingestPlaceholderData() {
  console.log('📚 Starting knowledge base ingestion...');

  if (!isEmbeddingReady()) {
    console.warn('⚠️ Embedding engine is not ready. Skipping re-embedding and loading existing vector cache.');
    reloadVectorCache();
    return getAllQAEmbeddings().length;
  }

  const existingRows = getAllQAEmbeddings();
  // Embedding model / strategy change => old vectors live in a different space. Rebuild all.
  let expertRows = [];
  const modelChanged =
    getMeta('embedding_model') !== EMBEDDING_MODEL ||
    getMeta('embedding_strategy') !== EMBEDDING_STRATEGY ||
    existingRows.length === 0;
  if (modelChanged) {
    console.log(`  ↻ Embedding model/strategy changed (${getMeta('embedding_model') || 'none'} → ${EMBEDDING_MODEL}). Re-embedding the whole knowledge base...`);
    expertRows = getDb().prepare(`SELECT question, answer, language, category, meta, review_queue_id FROM qa_embeddings WHERE source = 'expert_correction'`).all();
    clearQAEmbeddings();
  }

  const rowsAfterCheck = modelChanged ? [] : existingRows;
  const existingBySource = {};
  for (const r of rowsAfterCheck) {
    const src = r.source || 'placeholder';
    existingBySource[src] = (existingBySource[src] || 0) + 1;
  }

  let total = 0;

  if (fs.existsSync(PLACEHOLDER_DATA_PATH)) {
    try {
      const qaList = JSON.parse(fs.readFileSync(PLACEHOLDER_DATA_PATH, 'utf-8'));
      let expectedPlaceholder = 0;
      for (const item of qaList) {
        if (item.question_en && item.answer_en) expectedPlaceholder++;
        if (item.question_hi && item.answer_hi) expectedPlaceholder++;
        if (item.question_mr && item.answer_mr) expectedPlaceholder++;
      }
      const hash = fileHash(PLACEHOLDER_DATA_PATH);
      let n = 0;
      if (existingBySource['placeholder'] === expectedPlaceholder && expectedPlaceholder > 0 && getMeta('hash:placeholder') === hash) {
        n = expectedPlaceholder;
      } else {
        clearQAEmbeddings('placeholder');
        n = await ingestFlatQaList(qaList, 'placeholder');
        if (n > 0) setMeta('hash:placeholder', hash);
      }
      total += n;
      console.log(`  ✓ placeholder_qa.json → ${n} chunks`);
    } catch (err) {
      console.error('❌ Error parsing placeholder_qa.json:', err);
    }
  } else {
    console.warn('⚠️ placeholder_qa.json not found.');
  }

  const datasetCount = await ingestGrapeDataset(existingBySource);
  total += datasetCount;
  if (datasetCount > 0) {
    console.log(`  ✓ grape_dataset.json → ${datasetCount} chunks`);
  }

  const farmerQaCount = await ingestFarmerQaDataset(existingBySource);
  total += farmerQaCount;
  if (farmerQaCount > 0) {
    console.log(`  ✓ farmer_qa_cleaned.json → ${farmerQaCount} chunks`);
  }

  // Re-embed expert corrections that were wiped by a model change
  let restored = 0;
  for (const row of expertRows) {
    const ok = await embedAndStore({
      question: row.question,
      answer: row.answer,
      language: row.language,
      category: row.category,
      source: 'expert_correction',
      meta: row.meta ? JSON.parse(row.meta) : null,
      reviewQueueId: row.review_queue_id,
    });
    if (ok) restored++;
  }
  if (restored) console.log(`  ✓ expert corrections re-embedded → ${restored} chunks`);
  total += restored;

  if (modelChanged && total > 0) {
    setMeta('embedding_model', EMBEDDING_MODEL);
    setMeta('embedding_strategy', EMBEDDING_STRATEGY);
  }

  console.log(`✅ Ingested ${total} embedded chunks into database.`);
  reloadVectorCache();
  return total;
}
