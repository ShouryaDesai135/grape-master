/**
 * vectorStore.js — In-Memory Vector Search Engine
 * ═══════════════════════════════════════════════
 * 
 * Performs fast cosine similarity search over the QA embeddings.
 * For a small dataset (<10,000 chunks), doing this in JS memory
 * via brute-force dot product is actually faster than hitting an
 * external vector database like Pinecone or Milvus.
 */

import { getAllQAEmbeddings } from '../database.js';
import { bufferToFloat32Array } from './embeddingEngine.js';

let vectorCache = [];

/**
 * Loads all embeddings from SQLite into memory for fast searching.
 * Should be called on server startup and after new data ingestion.
 */
export function reloadVectorCache() {
  const rows = getAllQAEmbeddings();
  
  vectorCache = rows.map(row => {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      language: row.language,
      category: row.category,
      // Decode SQLite BLOB back to Float32Array
      vector: row.vector ? bufferToFloat32Array(row.vector) : null
    };
  }).filter(item => item.vector !== null);
  
  console.log(`🧠 Vector cache loaded: ${vectorCache.length} chunks available for RAG search.`);
}

/**
 * Compute Cosine Similarity between two Float32Arrays.
 * Assumes vectors are already normalized (L2 norm = 1).
 * Xenova/all-MiniLM-L6-v2 outputs normalized vectors if pooling: { normalize: true }
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

/**
 * Search the knowledge base for the most relevant chunks.
 * 
 * @param {Float32Array} queryVector - The 384-dimensional query embedding
 * @param {Object} options - Search options
 * @param {number} options.topK - Number of results to return
 * @param {string} options.language - Optional language filter
 * @returns {Array} Array of matched chunks sorted by similarity (highest first)
 */
export function semanticSearch(queryVector, { topK = 3, language = null } = {}) {
  if (!queryVector || vectorCache.length === 0) return [];

  let candidates = vectorCache;
  
  // Optional language filtering
  if (language) {
    candidates = candidates.filter(c => c.language === language);
  }

  // Calculate similarity for all candidates
  const scored = candidates.map(chunk => {
    return {
      ...chunk,
      similarity: cosineSimilarity(queryVector, chunk.vector)
    };
  });

  // Sort descending by similarity
  scored.sort((a, b) => b.similarity - a.similarity);

  // Exclude the raw vectors from the return object to save memory downstream
  return scored.slice(0, topK).map(item => {
    const { vector, ...rest } = item;
    return rest;
  });
}
