/**
 * preprocess_dataset.js — Multi-Year Historical Q&A Preprocessing Pipeline (PDF §3)
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Cleans, deduplicates, scrubs PII/HTML, normalizes units, classifies topics,
 * detects language, and optionally aligns/translates historical Q&A datasets.
 *
 * Usage:
 *   node scripts/preprocess_dataset.js [--input data/farmer_qa_cleaned.json] [--translate]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeText, scrubPii, detectLanguage, correctGrammarAndSpelling } from '../services/nlp.js';
import { initLLM, isLLMAvailable, translateTexts } from '../services/llmSynthesizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT = path.join(__dirname, '../data/farmer_qa_cleaned.json');
const DEFAULT_GOLD = path.join(__dirname, '../eval/gold_heldout.json');

const BOILERPLATE_PATTERNS = [
  /नमस्कार\s*भाऊ\s*,?/gi,
  /वरील उत्तराने आपले समाधान झाले नाही तर.*/gi,
  /प्रश्न समजला नाही.*/gi,
  /मागील प्रश्नाचे उत्तर.*/gi,
];

export function cleanRecordText(raw = '') {
  if (!raw || raw === 'NULL' || raw === 'NaN') return '';
  let t = String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h3|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  for (const pat of BOILERPLATE_PATTERNS) {
    t = t.replace(pat, '');
  }
  t = scrubPii(normalizeText(t));
  // Standardize dosage units
  t = t
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:ml|मि\.?ली\.?)\s*\/\s*(?:l|ltr|liter|litre|लिटर)\b/gi, '$1 ml/L')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:gm|g|gram|ग्रॅम)\s*\/\s*(?:l|ltr|liter|litre|लिटर)\b/gi, '$1 g/L');
  return t.trim();
}

export function classifyTopic(question = '', answer = '') {
  const txt = `${question} ${answer}`.toLowerCase();
  if (['डाऊनी', 'डाउनी', 'केवडा', 'downy', 'भुरी', 'पांढरी बुरशी', 'powdery', 'सल्फर', 'करपा', 'काळा करपा', 'blight', 'rot', 'कवच', 'm45', 'साफ'].some((w) => txt.includes(w))) {
    return 'disease';
  }
  if (['थ्रिप्स', 'थ्रीप्स', 'मिलीबग', 'पिठ्या', 'उडद्या', 'अळी', 'कोळी', 'ट्रेसर', 'मोव्हेन्टो', 'स्लेअर', 'thrips', 'mealybug'].some((w) => txt.includes(w))) {
    return 'pest';
  }
  if (['फुगवण', 'साईज', 'ga3', 'ga ', 'cppu', 'डिपिंग', 'घड', 'कळी', 'मणी', 'gibberellic'].some((w) => txt.includes(w))) {
    return 'growth_regulator';
  }
  if (['खत', 'डोस', 'बेसल', 'युरिया', 'पोटॅश', 'कॅल्शियम', 'मॅग्नेशियम', '0.52.34', '19.19', '12.61', '13.0.45', 'npk', 'fertilizer'].some((w) => txt.includes(w))) {
    return 'fertilizer';
  }
  if (['पाणी', 'ठिबक', 'ड्रीप', 'सिंचन', 'वाफसा', 'drip', 'irrigation'].some((w) => txt.includes(w))) {
    return 'irrigation';
  }
  if (['छाटणी', 'रिकट', 'शेंडा', 'पिंचिंग', 'काडी', 'पेस्ट', 'फुटत', 'pruning'].some((w) => txt.includes(w))) {
    return 'pruning';
  }
  return 'general';
}

export async function runPreprocessingPipeline({ inputPath = DEFAULT_INPUT, alignLanguages = false } = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Dataset file not found: ${inputPath}`);
  }

  const rawItems = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const seenQuestions = new Set();
  const processed = [];
  let piiScrubbedCount = 0;

  for (const item of rawItems) {
    const qRaw = item.question || '';
    const aRaw = item.answer || '';
    const qClean = cleanRecordText(qRaw);
    const aClean = cleanRecordText(aRaw);

    if (qClean.length < 15 || aClean.length < 30) continue;
    if (qClean.includes('[PHONE_REDACTED]') || aClean.includes('[PHONE_REDACTED]')) {
      piiScrubbedCount++;
    }

    const qKey = qClean.toLowerCase();
    if (seenQuestions.has(qKey)) continue;
    seenQuestions.add(qKey);

    const detected = detectLanguage(qClean);
    const category = item.category || classifyTopic(qClean, aClean);
    const hasDose = /\d/.test(aClean);

    processed.push({
      question: qClean,
      answer: aClean,
      language: item.language || detected.language || 'mr',
      category,
      stage: item.stage || '',
      variety: item.variety || '',
      hasDose,
    });
  }

  // Optional language alignment (PDF §3: "Translation or language alignment during training if required")
  if (alignLanguages) {
    initLLM();
    if (isLLMAvailable()) {
      const sample = processed.slice(0, 5);
      const enQuestions = await translateTexts(sample.map((s) => s.question), 'en');
      sample.forEach((s, idx) => { s.question_en_aligned = enQuestions[idx]; });
    }
  }

  const byCategory = {};
  const byLanguage = {};
  for (const p of processed) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byLanguage[p.language] = (byLanguage[p.language] || 0) + 1;
  }

  fs.writeFileSync(inputPath, JSON.stringify(processed, null, 1), 'utf-8');

  let goldCount = 0;
  if (fs.existsSync(DEFAULT_GOLD)) {
    const gold = JSON.parse(fs.readFileSync(DEFAULT_GOLD, 'utf-8'));
    goldCount = gold.length;
  }

  return {
    totalInput: rawItems.length,
    totalCleaned: processed.length,
    goldHeldOutCount: goldCount,
    piiScrubbedCount,
    byCategory,
    byLanguage,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const alignLanguages = process.argv.includes('--translate');
  runPreprocessingPipeline({ alignLanguages })
    .then((summary) => {
      console.log('📊 Dataset Preprocessing Summary (PDF §3):');
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error('❌ Preprocessing failed:', err.message);
      process.exit(1);
    });
}
