/**
 * ragAdvisoryEngine.js — Complete RAG Orchestration
 * ═════════════════════════════════════════════════
 * 
 * Orchestrates the full pipeline:
 * 1. Intent & Language analysis
 * 2. Vector Embedding of user query
 * 3. Semantic Search over knowledge base
 * 4. LLM Synthesis of natural language response
 * 5. Confidence scoring & escalation flagging
 */

import { generateEmbedding } from './embeddingEngine.js';
import { semanticSearch } from './vectorStore.js';
import { synthesizeResponse } from './llmSynthesizer.js';
import { detectLanguage } from './languageDetector.js';

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.75');

/**
 * Process a user query through the complete RAG pipeline.
 * 
 * @param {string} userQuery - The raw input from the farmer
 * @param {Array} conversationContext - Previous turns in this session
 * @param {Object} cnnResult - Optional image diagnosis results { prediction, confidence }
 * @returns {Object} { answer, language, ragConfidence, finalConfidence, flagged, intent }
 */
export async function processRagQuery(userQuery, conversationContext = [], cnnResult = null, explicitLanguage = null) {
  const startTime = Date.now();

  // 1. Language Detection & Normalization
  const { language: detectedLanguage, intent } = detectLanguage(userQuery || '');
  const language = explicitLanguage || detectedLanguage;

  // 2. Build Effective Query for Embedding
  // If an image was uploaded and user query is short/empty, include the CNN prediction in vector search
  let effectiveQuery = userQuery ? userQuery.trim() : '';
  if (cnnResult && cnnResult.prediction && effectiveQuery.length < 5) {
    const diseaseName = cnnResult.prediction.replace(/_/g, ' ');
    effectiveQuery = `${diseaseName} symptoms treatment and prevention`;
  }

  // 3. Embed the Query
  const queryVector = await generateEmbedding(effectiveQuery || 'grape disease advisory');

  let retrievedChunks = [];
  let vectorSimilarityScore = 0;

  // 4. Semantic Vector Search
  if (queryVector) {
    retrievedChunks = semanticSearch(queryVector, { topK: 3, language });
    
    if (retrievedChunks.length === 0) {
      retrievedChunks = semanticSearch(queryVector, { topK: 3 });
    }

    if (retrievedChunks.length > 0) {
      vectorSimilarityScore = retrievedChunks[0].similarity;
    }
  }

  // 5. Calculate Confidence Scores
  let ragConfidence = vectorSimilarityScore;
  let keywordMatchScore = calculateKeywordScore(effectiveQuery, retrievedChunks);
  
  let finalConfidence = (0.6 * ragConfidence) + (0.4 * keywordMatchScore);

  // Fuse with CNN confidence if an image was provided
  if (cnnResult && cnnResult.confidence != null) {
    // If vision model is confident (>= 0.70), weight Vision 60% + RAG Vector 40%
    if (cnnResult.confidence >= 0.70) {
      finalConfidence = (0.60 * cnnResult.confidence) + (0.40 * Math.max(ragConfidence, 0.75));
    } else {
      finalConfidence = (0.40 * cnnResult.confidence) + (0.35 * ragConfidence) + (0.25 * keywordMatchScore);
    }
  }

  // Cap at 0.99
  finalConfidence = Math.min(Math.max(finalConfidence, 0.60), 0.99);
  
  const isFlagged = finalConfidence < CONFIDENCE_THRESHOLD;

  // 5. LLM Synthesis
  // Synthesize natural language from retrieved chunks and cnn diagnosis
  const answer = await synthesizeResponse(
    userQuery, 
    retrievedChunks, 
    language, 
    conversationContext, 
    cnnResult
  );

  return {
    answer,
    language,
    ragConfidence,
    finalConfidence,
    isFlagged,
    intent,
    responseTimeMs: Date.now() - startTime
  };
}

/**
 * Fallback keyword scoring metric.
 * Checks how many significant words from the query appear in the top chunk.
 */
function calculateKeywordScore(query, chunks) {
  if (chunks.length === 0) return 0;
  
  const topChunk = chunks[0];
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (queryWords.length === 0) return 0.5;

  const targetText = `${topChunk.question} ${topChunk.answer}`.toLowerCase();
  
  let matchCount = 0;
  for (const word of queryWords) {
    if (targetText.includes(word)) matchCount++;
  }

  return matchCount / queryWords.length;
}
