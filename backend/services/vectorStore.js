/**
 * vectorStore.js — Hybrid (BM25 + vector) retrieval with calibrated confidence
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - Dense retrieval: cosine similarity over multilingual embeddings (normalized vectors)
 * - Sparse retrieval: in-memory BM25 over stemmed multilingual tokens
 * - Fusion: Reciprocal Rank Fusion (RRF) of the two rankings
 * - Metadata: optional farmer context (variety / stage) gives a small ranking nudge
 * - Confidence: logistic model over retrieval features (see retrievalConfidence).
 *   Coefficients are stored in kb_meta ('calibration') and can be re-fitted from the
 *   gold set with `npm run eval:fit`; defaults below are the starting point.
 *
 * Brute force is fine below ~10,000 chunks (see Phase 9.3 for migrating beyond).
 */

import { getAllQAEmbeddings, getMeta } from '../database.js';
import { bufferToFloat32Array } from './embeddingEngine.js';
import { tokenize } from './nlp.js';

let vectorCache = [];
let bm25 = null; // { df: Map, avgLen, N, docs: [{ tf: Map, len }] }

const BM25_K1 = 1.4;
const BM25_B = 0.75;
const RRF_K = 60;

export const DEFAULT_CALIBRATION = { bias: -4.2, vec: 6.0, coverage: 1.5, margin: 1.0 };

function parseMeta(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function buildBm25(chunks) {
  const df = new Map();
  const docs = chunks.map((c) => {
    // question text is the strongest signal: count it twice
    const tokens = [...tokenize(c.question), ...tokenize(c.question), ...tokenize(c.answer)];
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { tf, len: tokens.length };
  });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  return { df, avgLen, N: docs.length, docs };
}

/**
 * Loads all embeddings from SQLite into memory for fast searching.
 * Called on startup and after any knowledge-base change.
 */
export function reloadVectorCache() {
  const rows = getAllQAEmbeddings();

  vectorCache = rows
    .map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      language: row.language,
      category: row.category,
      source: row.source,
      meta: parseMeta(row.meta),
      vector: row.vector ? bufferToFloat32Array(row.vector) : null,
    }))
    .filter((item) => item.vector !== null);

  bm25 = buildBm25(vectorCache);
  console.log(`🧠 Vector cache loaded: ${vectorCache.length} chunks available for RAG search.`);
}

export function getCacheSize() {
  return vectorCache.length;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are L2-normalized
}

function bm25Scores(queryTokens) {
  const scores = new Array(vectorCache.length).fill(0);
  if (!bm25 || queryTokens.length === 0) return scores;
  const uniq = [...new Set(queryTokens)];
  for (let i = 0; i < bm25.docs.length; i++) {
    const doc = bm25.docs[i];
    let s = 0;
    for (const t of uniq) {
      const f = doc.tf.get(t);
      if (!f) continue;
      const n = bm25.df.get(t) || 0;
      const idf = Math.log(1 + (bm25.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.len / bm25.avgLen))));
    }
    scores[i] = s;
  }
  return scores;
}

/** Fraction of distinct query tokens that appear in a chunk (0..1). */
function coverage(queryTokens, chunk) {
  const uniq = [...new Set(queryTokens)];
  if (uniq.length === 0) return 0;
  const docTokens = new Set([...tokenize(chunk.question), ...tokenize(chunk.answer)]);
  let hit = 0;
  for (const t of uniq) if (docTokens.has(t)) hit++;
  return hit / uniq.length;
}

/**
 * Hybrid search.
 * @param {Float32Array} queryVector
 * @param {Object} opts
 * @param {number} opts.topK
 * @param {string} opts.queryText   raw (expanded) query, used for BM25 + coverage
 * @param {string} opts.language    preferred answer language (small ranking bonus, NOT a hard filter -
 *                                  the multilingual embedder lets Marathi questions match English chunks)
 * @param {{variety?:string, stage?:string}} opts.context  farmer context for metadata nudge
 * @returns {{ chunks: Array, features: Object }}
 */
export function hybridSearch(queryVector, { topK = 3, queryText = '', language = null, context = {} } = {}) {
  if (!queryVector || vectorCache.length === 0) {
    return { chunks: [], features: { vec: 0, coverage: 0, margin: 0, bm25: 0 } };
  }

  const queryTokens = tokenize(queryText);
  const vecSims = vectorCache.map((c) => cosineSimilarity(queryVector, c.vector));
  const bmScores = bm25Scores(queryTokens);

  // rank positions
  const order = (arr) => arr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const vecRank = new Map(order(vecSims).map((idx, r) => [idx, r]));
  const bmOrder = order(bmScores);
  const bmRank = new Map(bmOrder.map((idx, r) => [idx, r]));
  const maxBm = bmScores[bmOrder[0]] || 0;

  const fused = vectorCache.map((chunk, i) => {
    let score = 1 / (RRF_K + vecRank.get(i));
    if (bmScores[i] > 0) score += 1 / (RRF_K + bmRank.get(i));
    // small nudges (do not dominate the ranking)
    if (language && chunk.language === language) score *= 1.05;
    const m = chunk.meta;
    if (m && context.variety && m.variety && m.variety === context.variety) score *= 1.08;
    if (m && context.stage && m.stage && m.stage === context.stage) score *= 1.05;
    return { i, score };
  }).sort((a, b) => b.score - a.score);

  // de-duplicate near-identical answers (same answer in several languages / sources)
  const picked = [];
  const seenAnswers = new Set();
  for (const { i } of fused) {
    const c = vectorCache[i];
    const key = c.answer.slice(0, 80);
    if (seenAnswers.has(key)) continue;
    seenAnswers.add(key);
    picked.push(i);
    if (picked.length >= topK + 1) break;
  }

  const chunks = picked.slice(0, topK).map((i) => {
    const { vector, ...rest } = vectorCache[i];
    return {
      ...rest,
      similarity: vecSims[i],
      bm25: maxBm > 0 ? bmScores[i] / maxBm : 0,
      coverage: coverage(queryTokens, vectorCache[i]),
    };
  });

  const top = chunks[0];
  const secondVec = picked[1] !== undefined ? vecSims[picked[1]] : 0;
  const features = top
    ? { vec: top.similarity, coverage: top.coverage, margin: Math.max(0, top.similarity - secondVec), bm25: top.bm25 }
    : { vec: 0, coverage: 0, margin: 0, bm25: 0 };

  return { chunks, features };
}

function getCalibration() {
  try {
    const raw = getMeta('calibration');
    if (raw) return { ...DEFAULT_CALIBRATION, ...JSON.parse(raw) };
  } catch { /* use defaults */ }
  return DEFAULT_CALIBRATION;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Calibrated probability that the retrieved context actually answers the question.
 * Pure vector score is not a probability; this maps retrieval features to one.
 */
export function retrievalConfidence(features, calibration = getCalibration()) {
  const z = calibration.bias
    + calibration.vec * features.vec
    + calibration.coverage * features.coverage
    + calibration.margin * features.margin;
  return sigmoid(z);
}

/** Back-compat shim used by older callers. */
export function semanticSearch(queryVector, { topK = 3, language = null, queryText = '' } = {}) {
  return hybridSearch(queryVector, { topK, language, queryText }).chunks;
}

export { tokenize as tokenizeSignificantWords };
