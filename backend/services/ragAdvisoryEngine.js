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
  // If user says "bhuri", we know it's Marathi/Hindi for powdery mildew.
  // A robust production app translates this to a canonical form (English).
  // For this scope, we just detect the language to search the right vector space.
  const { language: detectedLanguage, intent } = detectLanguage(userQuery);
  const language = explicitLanguage || detectedLanguage;

  // 2. Embed the Query
  const queryVector = await generateEmbedding(userQuery);

  let retrievedChunks = [];
  let vectorSimilarityScore = 0;

  // 3. Semantic Vector Search
  if (queryVector) {
    // Search only chunks matching the detected language to improve accuracy
    // Fall back to all chunks if no specific match
    retrievedChunks = semanticSearch(queryVector, { topK: 3, language });
    
    // If we didn't find enough in their language, expand search
    if (retrievedChunks.length === 0) {
      retrievedChunks = semanticSearch(queryVector, { topK: 3 });
    }

    if (retrievedChunks.length > 0) {
      // The similarity of the top chunk is our baseline RAG confidence
      vectorSimilarityScore = retrievedChunks[0].similarity;
    }
  }

  // 4. Calculate Confidence Scores
  let ragConfidence = vectorSimilarityScore;
  
  // Keyword match boost (simulated for fallback/enhancement)
  let keywordMatchScore = calculateKeywordScore(userQuery, retrievedChunks);
  
  // Base text confidence = 60% vector + 40% keyword
  let finalConfidence = (0.6 * ragConfidence) + (0.4 * keywordMatchScore);

  // Fuse with CNN confidence if an image was provided
  if (cnnResult) {
    // PRD constraint: fuse image and text into a single combined response
    // Formula: 40% CNN + 35% Vector + 25% Keyword
    finalConfidence = (0.4 * cnnResult.confidence) + (0.35 * ragConfidence) + (0.25 * keywordMatchScore);
  }

  // Cap at 0.99
  finalConfidence = Math.min(finalConfidence, 0.99);
  
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
