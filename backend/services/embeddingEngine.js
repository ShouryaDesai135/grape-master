/**
 * embeddingEngine.js — Vector Embedding Service
 * ════════════════════════════════════════════
 * 
 * Uses @xenova/transformers to run NLP models 100% locally in Node.js.
 * No external API calls are made to generate embeddings.
 * 
 * Model: Xenova/all-MiniLM-L6-v2
 * Dimensions: 384
 * Pros: Small (~80MB), fast (cpu inference), multilingual capabilities.
 */

import { pipeline, env } from '@xenova/transformers';

// Disable local model caching to avoid complex disk setups in development,
// or configure it properly for production. For now, downloading on startup
// and caching in memory is fine.
env.allowLocalModels = true;
env.useBrowserCache = false;

let extractor = null;
let isLoading = false;
let isReady = false;

/**
 * Initialize the embedding model on server startup.
 * Downloads the model on first run (~80MB).
 */
export async function initEmbeddingEngine() {
  if (extractor || isLoading) return;
  isLoading = true;
  
  try {
    console.log('⏳ Loading local embedding model (Xenova/all-MiniLM-L6-v2)...');
    
    // Create the feature extraction pipeline
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    
    isReady = true;
    console.log('✅ Local embedding model loaded successfully.');
  } catch (error) {
    console.error('❌ Failed to load embedding model:', error);
    // Graceful degradation: we will fallback to keyword matching if embedding fails
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
