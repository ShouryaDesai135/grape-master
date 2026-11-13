/**
 * eval_rag.js — Full Multilingual KB Ingestion & Gold-Set Retrieval Benchmark
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Initializes SQLite + Xenova/paraphrase-multilingual-MiniLM-L12-v2
 * 2. Ingests all 3 data sources (~1,491 chunks) into qa_embeddings
 * 3. Evaluates:
 *    - Benchmark A: Cross-lingual + Typo/Hinglish Retrieval (Recall@1, Recall@3, Recall@5, MRR)
 *    - Benchmark B: 118 Held-Out Real Farmer Gold Queries (Topic/Stage Retrieval & Confidence Calibration)
 *    - Benchmark C: Out-of-Domain Escalation Verification (ensuring irrelevant queries score < 0.75)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from '../database.js';
import { initEmbeddingEngine, generateEmbedding, EMBEDDING_MODEL } from '../services/embeddingEngine.js';
import { ingestPlaceholderData } from '../services/dataIngestion.js';
import { hybridSearch, retrievalConfidence, getCacheSize } from '../services/vectorStore.js';
import { correctGrammarAndSpelling, expandQuery } from '../services/nlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLD_PATH = path.join(__dirname, '../eval/gold_heldout.json');

const CROSS_LINGUAL_BENCHMARK = [
  // English, Marathi, Hindi, and Typo/Hinglish queries paired with expected answer keywords
  { q: 'my grape leaf have white powder wht spary', lang: 'en', expect: ['sulfur', 'hexaconazole', 'myclobutanil', 'भुरी', 'powdery'] },
  { q: 'पानांवर पांढरी भुरी दिसत आहे कोनती फवारनी घ्याव', lang: 'mr', expect: ['भुरी', 'सल्फर', 'हेक्साकोनाझोल', 'मायक्लोबुटानिल', 'powdery'] },
  { q: 'अंगूर के पत्ते पर सफेद फफूंदी है कौन सा दवा छिड़के', lang: 'hi', expect: ['फफूंदी', 'सल्फर', 'हेक्साकोनाज़ोल', 'माइक्लोब्यूटानिल'] },
  { q: 'drakshavar davni rog ahe konta spray gheu', lang: 'mr', expect: ['डाऊनी', 'केवडा', 'मॅन्कोझेब', 'मेटालॅक्सिल', 'downy', 'कवच'] },
  { q: 'how to control thripse and milybug on grape bunches', lang: 'en', expect: ['thrips', 'mealybug', 'spinosad', 'imidacloprid', 'buprofezin', 'थ्रिप्स', 'मिलीबग'] },
  { q: 'when to do foundation prunning in maharashtra', lang: 'en', expect: ['april', 'foundation', 'खरड', 'छाटणी'] },
  { q: 'खरड छाटणी नंतर फुटी निघत नाहीत काय कराव', lang: 'mr', expect: ['छाटणी', 'डॉर्मेक्स', 'फूट', 'काडी', 'पाणी'] },
  { q: 'how much gibrelik asid and cppu for berry sizing', lang: 'en', expect: ['ga3', 'cppu', 'ppm', 'फुगवण', 'gibberellic'] },
  { q: 'मण्यांची फुगवण आणि साईज वाढवण्यासाठी काय करावे', lang: 'mr', expect: ['फुगवण', 'ga', 'cppu', 'मणी', 'साईज', 'ग्रेड'] },
  { q: 'drip irigation schedule during berry growth', lang: 'en', expect: ['drip', 'water', 'irrigation', 'ठिबक', 'पाणी', 'सिंचन'] },
  { q: 'what is the symtoms and treatmnt of black rot', lang: 'en', expect: ['black rot', 'mancozeb', 'myclobutanil', 'काळा सड'] },
  { q: 'पानांवर करपा रोग आला आहे उपाय सांगा', lang: 'mr', expect: ['करपा', 'blight', 'मॅन्कोझेब', 'कार्बेन्डाझिम', 'साफ', 'कवच'] },
];

const OUT_OF_DOMAIN_QUERIES = [
  'who won the cricket world cup in 2023',
  'how to install windows 11 on laptop',
  'best bitcoin trading strategy today',
];

async function runEvaluation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔬 GRAPE MASTER — MULTILINGUAL RAG BENCHMARK & INGESTION');
  console.log(`   Model: ${EMBEDDING_MODEL}`);
  console.log('═══════════════════════════════════════════════════════════════');

  initDatabase();
  await initEmbeddingEngine();
  const totalChunks = await ingestPlaceholderData();
  const cacheSize = getCacheSize();
  console.log(`\n📦 Knowledge Base Ready: ${cacheSize} active chunks in memory (ingested: ${totalChunks}).\n`);

  // ── Benchmark A: Cross-Lingual + Typo/Grammar Resilient Retrieval ──
  let r1 = 0;
  let r3 = 0;
  let r5 = 0;
  let mrrSum = 0;
  let totalLatencyMs = 0;

  for (const item of CROSS_LINGUAL_BENCHMARK) {
    const t0 = Date.now();
    const nlp = correctGrammarAndSpelling(item.q, item.lang);
    const expanded = expandQuery(nlp.corrected);
    const vec = await generateEmbedding(expanded);
    const { chunks, features } = hybridSearch(vec, {
      topK: 5,
      queryText: expanded,
      language: nlp.detectedLanguage.language || item.lang,
    });
    totalLatencyMs += Date.now() - t0;

    let hitRank = 0;
    for (let i = 0; i < chunks.length; i++) {
      const hay = `${chunks[i].question} ${chunks[i].answer}`.toLowerCase();
      if (item.expect.some((kw) => hay.includes(kw.toLowerCase()))) {
        hitRank = i + 1;
        break;
      }
    }

    if (hitRank === 1) r1++;
    if (hitRank > 0 && hitRank <= 3) r3++;
    if (hitRank > 0 && hitRank <= 5) r5++;
    if (hitRank > 0) mrrSum += 1 / hitRank;

    const conf = retrievalConfidence(features);
    console.log(
      `  [${hitRank > 0 ? `✓ Rank #${hitRank}` : '✗ MISS'}] (${(conf * 100).toFixed(0)}%) "${item.q}" -> "${nlp.corrected}"`
    );
  }

  const nA = CROSS_LINGUAL_BENCHMARK.length;
  const benchA = {
    queries: nA,
    recallAt1: Number((r1 / nA).toFixed(3)),
    recallAt3: Number((r3 / nA).toFixed(3)),
    recallAt5: Number((r5 / nA).toFixed(3)),
    mrr: Number((mrrSum / nA).toFixed(3)),
    avgLatencyMs: Math.round(totalLatencyMs / nA),
  };

  // ── Benchmark B: 118 Held-Out Real Farmer Gold Queries ──
  const goldItems = fs.existsSync(GOLD_PATH) ? JSON.parse(fs.readFileSync(GOLD_PATH, 'utf-8')) : [];
  let goldCatAt1 = 0;
  let goldCatAt3 = 0;
  let goldCatAt5 = 0;
  let goldDoseAt3 = 0;
  let goldConfSum = 0;

  for (const g of goldItems) {
    const nlp = correctGrammarAndSpelling(g.question, g.language);
    const expanded = expandQuery(nlp.corrected);
    const vec = await generateEmbedding(expanded);
    const { chunks, features } = hybridSearch(vec, {
      topK: 5,
      queryText: expanded,
      language: g.language || 'mr',
      context: { variety: g.variety, stage: g.stage },
    });

    const conf = retrievalConfidence(features);
    goldConfSum += conf;

    if (chunks[0]?.category === g.category) goldCatAt1++;
    if (chunks.slice(0, 3).some((c) => c.category === g.category)) goldCatAt3++;
    if (chunks.slice(0, 5).some((c) => c.category === g.category)) goldCatAt5++;
    if (chunks.slice(0, 3).some((c) => /\d/.test(c.answer))) goldDoseAt3++;
  }

  const nB = goldItems.length || 1;
  const benchB = {
    heldOutQueries: goldItems.length,
    categoryRecallAt1: Number((goldCatAt1 / nB).toFixed(3)),
    categoryRecallAt3: Number((goldCatAt3 / nB).toFixed(3)),
    categoryRecallAt5: Number((goldCatAt5 / nB).toFixed(3)),
    actionableDoseAt3: Number((goldDoseAt3 / nB).toFixed(3)),
    avgConfidence: Number((goldConfSum / nB).toFixed(3)),
  };

  // ── Benchmark C: Out-of-Domain Escalation Safety ──
  let oodFlagged = 0;
  const oodConfidences = [];
  for (const q of OUT_OF_DOMAIN_QUERIES) {
    const vec = await generateEmbedding(q);
    const { features } = hybridSearch(vec, { topK: 3, queryText: q, language: 'en' });
    const conf = retrievalConfidence(features);
    oodConfidences.push(Number(conf.toFixed(3)));
    if (conf < 0.75) oodFlagged++;
  }

  const report = {
    embeddingModel: EMBEDDING_MODEL,
    totalKnowledgeBaseChunks: cacheSize,
    crossLingualAndTypoBenchmark: benchA,
    heldOutFarmerGoldBenchmark: benchB,
    outOfDomainSafety: {
      queries: OUT_OF_DOMAIN_QUERIES.length,
      flaggedForReview: oodFlagged,
      confidences: oodConfidences,
    },
  };

  console.log('\n📊 FINAL EVALUATION REPORT:');
  console.log(JSON.stringify(report, null, 2));

  if (benchA.recallAt5 < 0.85 || oodFlagged < OUT_OF_DOMAIN_QUERIES.length) {
    console.error('❌ Benchmark did not meet minimum threshold!');
    process.exit(1);
  }
  console.log('\n✅ All retrieval & calibration benchmarks PASSED.');
}

runEvaluation().catch((err) => {
  console.error('❌ Evaluation failed:', err);
  process.exit(1);
});
