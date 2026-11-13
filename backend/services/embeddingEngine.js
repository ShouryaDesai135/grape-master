/**
 * embeddingEngine.js — Vector Embedding Service
 * ════════════════════════════════════════════
 * 
 * Uses @xenova/transformers to run NLP models 100% locally in Node.js.
 * No external API calls are made to generate embeddings.
 * 
 * Default model: Xenova/paraphrase-multilingual-MiniLM-L12-v2
 *   - 384 dimensions, trained on 50+ languages including Hindi and Marathi
 *   - Quantized ONNX build is ~120MB, downloaded once and cached
 * Override with EMBEDDING_MODEL (changing it re-embeds the knowledge base on next boot).
 */

import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = true;
env.useBrowserCache = false;

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

let extractor = null;
let isLoading = false;
let isReady = false;

export function isEmbeddingReady() {
  return isReady;
}

/**
 * Initialize the embedding model on server startup.
 * Downloads the model on first run.
 */
export async function initEmbeddingEngine() {
  if (extractor || isLoading) return;
  isLoading = true;
  
  try {
    console.log(`⏳ Loading local embedding model (${EMBEDDING_MODEL})...`);
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL);
    isReady = true;
    console.log('✅ Local embedding model loaded successfully.');
  } catch (error) {
    console.error('❌ Failed to load embedding model:', error);
  } finally {
    isLoading = false;
  }
}

/**
 * Generate a 384-dimensional vector embedding for the given text.
 * 
 * @param {string} text - The input text to embed
 * @returns {Float32Array|null} The vector embedding, or null if engine not ready
 */
export async function generateEmbedding(text) {
  if (!isReady || !extractor) {
    console.warn('⚠️ Embedding engine not ready. Falling back.');
    return null;
  }

  try {
    // Generate embedding. Output is a Tensor.
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    
    // Return the raw Float32Array
    return output.data;
  } catch (error) {
    console.error('❌ Error generating embedding:', error);
    return null;
  }
}

/**
 * Converts a Float32Array to a Buffer (BLOB) for SQLite storage
 */
export function float32ArrayToBuffer(arr) {
  return Buffer.from(arr.buffer);
}

/**
 * Converts a SQLite Buffer (BLOB) back to a Float32Array
 */
export function bufferToFloat32Array(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / Float32Array.BYTES_PER_ELEMENT);
}
