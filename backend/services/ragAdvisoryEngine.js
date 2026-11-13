/**
 * ragAdvisoryEngine.js — Complete RAG Orchestration
 * ═════════════════════════════════════════════════
 *
 * Pipeline:
 *  1. NLP: normalize -> language detection -> follow-up resolution -> glossary expansion
 *  2. Embed (multilingual) + intent classification
 *  3. Hybrid retrieval (BM25 + vectors, RRF) with farmer-context nudges
 *  4. Calibrated confidence (retrieval) fused with image certainty
 *  5. Safety rules (dose must be present for dosage questions)
 *  6. LLM synthesis grounded ONLY on retrieved chunks
 *
 * Two numbers are reported separately so the UI can explain them:
 *   imageConfidence  - calibrated CNN certainty (only when a photo was sent)
 *   ragConfidence    - probability that retrieved context answers the question
 * finalConfidence drives escalation to the expert review queue.
 */

import { generateEmbedding } from './embeddingEngine.js';
import { hybridSearch, retrievalConfidence } from './vectorStore.js';
import { synthesizeResponse, rewriteFollowUp } from './llmSynthesizer.js';
import { normalizeText, scrubPii, correctGrammarAndSpelling, expandQuery, detectLanguage, classifyIntent, tokenize } from './nlp.js';

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.75');
const DOSE_INTENTS = new Set(['treatment', 'fertilizer', 'growth_regulator', 'pest']);

/**
 * Rule-based follow-up resolution: very short messages ("what dose?", "organic option?")
 * inherit the topic of the last farmer turn. LLM rewrite is tried first when available.
 */
async function resolveFollowUp(query, conversationContext) {
  if (!conversationContext.length) return query;
  const shortQuery = tokenize(query).length <= 4;
  if (!shortQuery) return query;

  const llmRewrite = await rewriteFollowUp(query, conversationContext);
  if (llmRewrite) return llmRewrite;

  const lastFarmerTurn = [...conversationContext].reverse().find((t) => t.role === 'farmer' && t.canonical);
  return lastFarmerTurn ? `${lastFarmerTurn.canonical} ${query}` : query;
}

/**
 * @param {string} userQuery
 * @param {Array}  conversationContext previous turns in this session
 * @param {Object} cnnResult optional { prediction, confidence, alternatives }
 * @param {string} explicitLanguage UI language preference
 * @param {Object} farmerContext optional { variety, pruningType, stage, daysAfterPruning, region }
 */
export async function processRagQuery(userQuery, conversationContext = [], cnnResult = null, explicitLanguage = null, farmerContext = {}) {
  const startTime = Date.now();

  // 1. NLP: PII scrubbing -> spell/typo & grammar correction -> language detection
  const privacySafeQuery = scrubPii(normalizeText(userQuery || ''));
  const nlpCheck = correctGrammarAndSpelling(privacySafeQuery, explicitLanguage);
  const cleanQuery = nlpCheck.corrected;
  const detected = nlpCheck.detectedLanguage || detectLanguage(cleanQuery);

  // If the farmer typed in Devanagari (Marathi/Hindi) while UI dropdown was left on 'en',
  // respect the script of the farmer's actual query (PDF §2 Accurate Language Detection).
  let language = explicitLanguage || detected.language;
  if (detected.script === 'devanagari' && detected.confidence >= 0.60 && (!explicitLanguage || explicitLanguage === 'en')) {
    language = detected.language;
  }

  // 2. Effective query: resolve follow-ups, add leaf CNN disease (only when subject is a grape leaf!), expand glossary
  let effectiveQuery = cleanQuery.length ? await resolveFollowUp(cleanQuery, conversationContext) : '';
  const isLeafDiagnosis = cnnResult?.prediction && (!cnnResult.subjectType || cnnResult.subjectType === 'grape_leaf') && !cnnResult.notLeaf;
  if (isLeafDiagnosis) {
    const diseaseName = String(cnnResult.prediction).replace(/_/g, ' ');
    effectiveQuery = effectiveQuery.length < 5
      ? `${diseaseName} symptoms treatment and prevention`
      : `${diseaseName} ${effectiveQuery}`;
  } else if (cnnResult?.subjectType && effectiveQuery.length < 5) {
    const defaultSubjectQueries = {
      grape_berries: 'grape berry bunch sizing cracking rot management',
      insect_pest: 'grape thrips mealybug flea beetle pest control',
      soil: 'grape vineyard soil management basal fertilizer irrigation',
    };
    effectiveQuery = defaultSubjectQueries[cnnResult.subjectType] || '';
  }
  effectiveQuery = expandQuery(effectiveQuery);

  // 3. Embed + intent
  const queryVector = effectiveQuery ? await generateEmbedding(effectiveQuery) : null;
  const intentResult = await classifyIntent(cleanQuery || effectiveQuery, queryVector);

  // 4. Hybrid retrieval
  let chunks = [];
  let features = { vec: 0, coverage: 0, margin: 0, bm25: 0 };
  if (queryVector) {
    ({ chunks, features } = hybridSearch(queryVector, {
      topK: 3,
      queryText: effectiveQuery,
      language,
      context: { variety: farmerContext.variety, stage: farmerContext.pruningType },
    }));
  }

  // 5. Confidence
  const ragConfidence = chunks.length ? retrievalConfidence(features) : 0;
  const keywordMatchScore = features.coverage;
  const imageConfidence = cnnResult && cnnResult.confidence != null ? cnnResult.confidence : null;

  let finalConfidence = ragConfidence;
  if (imageConfidence != null) {
    finalConfidence = (0.45 * imageConfidence) + (0.35 * ragConfidence) + (0.20 * keywordMatchScore);
  }
  finalConfidence = Math.min(Math.max(finalConfidence, 0), 0.99);

  // 6. Safety: dosage-type questions need a number in the retrieved answer; non-leaf / triage photos always escalate
  let safetyEscalation = false;
  if (DOSE_INTENTS.has(intentResult.intent) && chunks.length && !/\d/.test(chunks[0].answer)) {
    finalConfidence = Math.min(finalConfidence, CONFIDENCE_THRESHOLD - 0.01);
    safetyEscalation = true;
  }
  if (cnnResult?.needsFollowUp || cnnResult?.notLeaf) {
    finalConfidence = Math.min(finalConfidence, CONFIDENCE_THRESHOLD - 0.05);
    safetyEscalation = true;
  }

  const isFlagged = finalConfidence < CONFIDENCE_THRESHOLD;

  // 7. LLM synthesis (grounded, using grammar-corrected query for clarity)
  const answer = await synthesizeResponse(
    cleanQuery || userQuery || '',
    chunks,
    language,
    conversationContext,
    cnnResult,
    farmerContext
  );

  return {
    answer,
    language,
    languageDetected: detected.language,
    correctedQuery: cleanQuery,
    hasNlpChanges: nlpCheck.hasChanges,
    nlpCorrections: nlpCheck.corrections,
    ragConfidence,
    imageConfidence,
    finalConfidence,
    isFlagged,
    safetyEscalation,
    intent: intentResult.intent,
    intentMethod: intentResult.method,
    sources: chunks.map((c) => ({ id: c.id, source: c.source, category: c.category, similarity: Number(c.similarity.toFixed(3)) })),
    features,
    responseTimeMs: Date.now() - startTime,
  };
}
