/**
 * dataIngestion.js — Knowledge Base Chunking & Indexing
 * ═════════════════════════════════════════════════════
 *
 * Ingests placeholder Q&A pairs and the structured grape_dataset.json
 * (diseases + advisory FAQs) into multilingual embedding chunks.
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
const GRAPE_DATASET_PATH = path.join(__dirname, '../data/grape_dataset.json');

const LANGS = ['en', 'hi', 'mr'];

async function embedAndStore({ question, answer, language, category, source }) {
  if (!question || !answer) return false;
  const prefix = language === 'en' ? 'Question' : 'प्रश्न';
  const answerPrefix = language === 'en' ? 'Answer' : 'उत्तर';
  const textToEmbed = `${prefix}: ${question}\n${answerPrefix}: ${answer}`;
  const vector = await generateEmbedding(textToEmbed);
  if (!vector) return false;
  insertQAEmbedding({
    question,
    answer,
    language,
    category,
    vector: float32ArrayToBuffer(vector),
    source,
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

async function ingestGrapeDataset() {
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

  clearQAEmbeddings('grape_dataset');
  let count = 0;

  for (const disease of dataset.diseases || []) {
    for (const pair of diseaseToQaPairs(disease)) {
      if (await embedAndStore({ ...pair, source: 'grape_dataset' })) count++;
    }
  }

  for (const faq of dataset.advisoryFAQs || []) {
    const category = faq.category || 'general';
    for (const lang of LANGS) {
      const question = faq.question?.[lang] || faq.question?.en;
      const answer = faq.answer?.[lang] || faq.answer?.en;
      if (await embedAndStore({ question, answer, language: lang, category, source: 'grape_dataset' })) count++;
    }
  }

  return count;
}

/**
 * Full knowledge-base ingest: placeholder QAs + structured grape dataset.
 */
export async function ingestPlaceholderData() {
  console.log('📚 Starting knowledge base ingestion...');

  let total = 0;

  if (fs.existsSync(PLACEHOLDER_DATA_PATH)) {
    clearQAEmbeddings('placeholder');
    try {
      const qaList = JSON.parse(fs.readFileSync(PLACEHOLDER_DATA_PATH, 'utf-8'));
      const n = await ingestFlatQaList(qaList, 'placeholder');
      total += n;
      console.log(`  ✓ placeholder_qa.json → ${n} chunks`);
    } catch (err) {
      console.error('❌ Error parsing placeholder_qa.json:', err);
    }
  } else {
    console.warn('⚠️ placeholder_qa.json not found.');
  }

  const datasetCount = await ingestGrapeDataset();
  total += datasetCount;
  if (datasetCount > 0) {
    console.log(`  ✓ grape_dataset.json → ${datasetCount} chunks`);
  }

  console.log(`✅ Ingested ${total} embedded chunks into database.`);
  reloadVectorCache();
  return total;
}
