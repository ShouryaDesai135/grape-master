/**
 * visionEngine.js — Multimodal Subject Gate (CLIP) + 7-Class Leaf CNN Engine
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Stage 1: Magic-byte & dimension verification via sharp (`validateImageFile`)
 * Stage 2: Local Zero-Shot CLIP Subject Gate (`Xenova/clip-vit-base-patch32`)
 *          classifies uploads into:
 *            - 'grape_leaf'    -> routed to Stage 3 (7-class PlantVillage Leaf CNN)
 *            - 'grape_berries' -> skips leaf CNN; triggers fruit triage + follow-up Qs + review queue
 *            - 'insect_pest'   -> skips leaf CNN; triggers pest triage + follow-up Qs + review queue
 *            - 'soil'          -> skips leaf CNN; triggers soil triage + follow-up Qs + review queue
 *            - 'other'         -> flagged as non-crop (`notLeaf: true`)
 * Stage 3: Custom 7-class TensorFlow.js CNN for grape leaf diseases with temperature calibration.
 */

import * as tf from '@tensorflow/tfjs';
import { pipeline, env } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

env.allowLocalModels = true;
env.useBrowserCache = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calibration / behaviour knobs (all overridable via env)
const CNN_TEMPERATURE = parseFloat(process.env.CNN_TEMPERATURE || '1');
const UNCERTAIN_BELOW = parseFloat(process.env.CNN_UNCERTAIN_BELOW || '0.60');
const NOT_LEAF_BELOW = parseFloat(process.env.CNN_NOT_LEAF_BELOW || '0.35');
const MODEL_VERSION = process.env.CNN_MODEL_VERSION || 'grape-cnn-v1+clip-gate';
const CLIP_MODEL = process.env.CLIP_MODEL || 'Xenova/clip-vit-base-patch32';
const ENABLE_CLIP_GATE = process.env.ENABLE_CLIP_GATE !== 'false';
const ALLOW_MOCK = process.env.ALLOW_MOCK_VISION === 'true';

const MODEL_DIR = path.join(__dirname, '../../model/output/tfjs_model');

// Classes exactly as defined in CNN training (alphabetical order)
export const LEAF_CLASSES = [
  'bacterial_rot',
  'black_rot',
  'downy_mildew',
  'esca',
  'healthy',
  'leaf_blight',
  'powdery_mildew',
];

const CLIP_SUBJECT_PROMPTS = [
  { key: 'grape_leaf', label: 'Grape Leaf', prompt: 'a close-up photo of a green plant leaf or grape vine leaf' },
  { key: 'grape_berries', label: 'Grape Berries / Bunch', prompt: 'a photo of grape berries or a fruit bunch on a vine' },
  { key: 'insect_pest', label: 'Insect / Pest on Crop', prompt: 'a close-up photo of an insect bug or pest on a plant' },
  { key: 'soil', label: 'Vineyard Soil / Ground', prompt: 'a photo of farm soil dirt or ground' },
  { key: 'other', label: 'Unrelated / Non-Crop Object', prompt: 'a photo of a person vehicle document screen bottle or unrelated object' },
];

const PROMPT_TO_SUBJECT = new Map(CLIP_SUBJECT_PROMPTS.map((s) => [s.prompt, s]));
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff', 'avif']);

let cnnModel = null;
let clipClassifier = null;
let isReady = false;
let isClipReady = false;

export function isVisionReady() {
  return isReady;
}

export function isSubjectGateReady() {
  return isClipReady;
}

function cleanLayerConfig(config) {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config)) return config.map(cleanLayerConfig);

  const cleaned = {};
  for (let [k, v] of Object.entries(config)) {
    if (k === 'module' || k === 'registered_name') continue;
    if (k.includes('regularizer') || k.includes('Regularizer')) v = null;
    if (k === 'batch_input_shape') k = 'batchInputShape';
    if (k === 'data_format') k = 'dataFormat';
    if (k === 'kernel_size') k = 'kernelSize';
    if (k === 'dilation_rate') k = 'dilationRate';
    if (k === 'use_bias') k = 'useBias';
    if (k === 'pool_size') k = 'poolSize';
    if (k === 'axis' && Array.isArray(v)) v = v[0];
    cleaned[k] = cleanLayerConfig(v);
  }
  return cleaned;
}

function cleanKerasTopology(topology) {
  const cleaned = JSON.parse(JSON.stringify(topology));
  if (cleaned.model_config?.config?.layers) {
    cleaned.model_config.config.layers = cleaned.model_config.config.layers.map((layer) => {
      if (layer.config) layer.config = cleanLayerConfig(layer.config);
      return layer;
    });
  }
  return cleaned;
}

function createLocalModelLoader(modelJsonPath) {
  return {
    load: async () => {
      const modelJsonDir = path.dirname(modelJsonPath);
      const rawJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));

      const modelTopology = cleanKerasTopology(rawJson.modelTopology);
      const weightsManifest = rawJson.weightsManifest;

      const weightSpecs = [];
      const weightBuffers = [];

      for (const group of weightsManifest) {
        weightSpecs.push(...group.weights);
        for (const filename of group.paths) {
          const weightPath = path.join(modelJsonDir, filename);
          weightBuffers.push(fs.readFileSync(weightPath));
        }
      }

      const combinedBuffer = Buffer.concat(weightBuffers);
      const weightData = combinedBuffer.buffer.slice(
        combinedBuffer.byteOffset,
        combinedBuffer.byteOffset + combinedBuffer.byteLength
      );

      return { modelTopology, weightSpecs, weightData };
    },
  };
}

/**
 * Validate that an uploaded file is a genuine image using magic bytes (sharp metadata)
 * and has reasonable dimensions.
 */
export async function validateImageFile(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return { valid: false, error: 'Image file not found' };
  }
  try {
    const meta = await sharp(imagePath).metadata();
    if (!meta || !meta.format || !ALLOWED_FORMATS.has(meta.format)) {
      return { valid: false, error: `Unsupported image format: ${meta?.format || 'unknown'}` };
    }
    if ((meta.width || 0) < 16 || (meta.height || 0) < 16) {
      return { valid: false, error: 'Image dimensions are too small (minimum 16x16px)' };
    }
    return { valid: true, format: meta.format, width: meta.width, height: meta.height };
  } catch {
    return { valid: false, error: 'Corrupt or invalid image file' };
  }
}

/**
 * Initialize the 7-class CNN model + optional Zero-Shot CLIP Subject Gate on server startup.
 */
export async function initVisionEngine() {
  try {
    const modelJsonPath = path.join(MODEL_DIR, 'model.json');
    if (!fs.existsSync(modelJsonPath)) {
      console.warn('⚠️ CNN model.json not found. Vision Engine running without leaf CNN.');
    } else if (!isReady) {
      console.log('⏳ Loading custom 7-class CNN Vision Model from disk...');
      cnnModel = await tf.loadLayersModel(createLocalModelLoader(modelJsonPath));
      cnnModel.predict(tf.zeros([1, 224, 224, 3])).dispose();
      isReady = true;
      console.log('✅ CNN Vision Model loaded successfully.');
    }
  } catch (error) {
    console.error('❌ Failed to load CNN model:', error);
  }

  if (ENABLE_CLIP_GATE && !clipClassifier) {
    try {
      console.log(`⏳ Loading Zero-Shot CLIP Subject Gate (${CLIP_MODEL})...`);
      clipClassifier = await pipeline('zero-shot-image-classification', CLIP_MODEL);
      isClipReady = true;
      console.log('✅ Zero-Shot CLIP Subject Gate loaded successfully.');
    } catch (err) {
      console.warn('⚠️ CLIP Subject Gate unavailable (continuing with 7-class CNN only):', err.message);
    }
  }
}

/**
 * Run the Zero-Shot CLIP Subject Gate on an image path.
 * Returns { subjectType, subjectLabel, subjectConfidence, scores }.
 */
export async function classifyImageSubject(imagePath) {
  if (!isClipReady || !clipClassifier) {
    return { subjectType: 'grape_leaf', subjectLabel: 'Grape Leaf', subjectConfidence: 1.0, scores: [] };
  }
  const labels = CLIP_SUBJECT_PROMPTS.map((s) => s.prompt);
  const rawScores = await clipClassifier(imagePath, labels);
  const mapped = rawScores.map((r) => {
    const meta = PROMPT_TO_SUBJECT.get(r.label) || { key: 'grape_leaf', label: 'Grape Leaf' };
    return { subjectType: meta.key, label: meta.label, confidence: Number(r.score.toFixed(4)) };
  });
  const top = mapped[0] || { subjectType: 'grape_leaf', label: 'Grape Leaf', confidence: 0.5 };
  return {
    subjectType: top.subjectType,
    subjectLabel: top.label,
    subjectConfidence: top.confidence,
    scores: mapped,
  };
}

/**
 * Process an uploaded image:
 *  1. Validate image magic bytes via sharp
 *  2. Run CLIP Subject Gate ('grape_leaf' | 'grape_berries' | 'insect_pest' | 'soil' | 'other')
 *  3. If 'other' -> return notLeaf: true (reject non-crop image)
 *  4. If 'grape_berries' | 'insect_pest' | 'soil' -> skip leaf CNN, return subject triage
 *     with needsFollowUp: true so RAG uses farmer text + asks clarifying questions + queues for expert review
 *  5. If 'grape_leaf' -> run 7-class TF.js Leaf CNN
 */
export async function analyzeImage(imagePath) {
  const check = await validateImageFile(imagePath);
  if (!check.valid) {
    throw new Error(check.error);
  }

  // 1. Run CLIP Subject Gate when available
  let subject = { subjectType: 'grape_leaf', subjectLabel: 'Grape Leaf', subjectConfidence: 1.0, scores: [] };
  if (isClipReady && clipClassifier) {
    try {
      subject = await classifyImageSubject(imagePath);
    } catch (err) {
      console.warn('⚠️ CLIP subject check failed, falling back to CNN:', err.message);
    }
  }

  // 2. Non-crop / unrelated object rejected before CNN
  if (subject.subjectType === 'other' && subject.subjectConfidence >= 0.50) {
    return {
      subjectType: 'other',
      subjectLabel: subject.subjectLabel,
      subjectConfidence: subject.subjectConfidence,
      prediction: 'Unrelated / Non-Crop Photo',
      predictionKey: 'other',
      confidence: 0.15,
      alternatives: subject.scores.slice(0, 3).map((s) => ({ label: s.label, confidence: s.confidence })),
      uncertain: true,
      notLeaf: true,
      needsFollowUp: false,
      modelVersion: MODEL_VERSION,
      isMock: false,
    };
  }

  // 3. Fruit bunch, Insect Pest, or Vineyard Soil: skip leaf-only CNN to avoid false chemical advice
  if (['grape_berries', 'insect_pest', 'soil'].includes(subject.subjectType) && subject.subjectConfidence >= 0.45) {
    return {
      subjectType: subject.subjectType,
      subjectLabel: subject.subjectLabel,
      subjectConfidence: subject.subjectConfidence,
      prediction: `${subject.subjectLabel} (Expert Triage)`,
      predictionKey: subject.subjectType,
      // Cap confidence at 0.55 so finalConfidence stays below 0.75 and routes to the expert review queue
      confidence: Math.min(subject.subjectConfidence, 0.55),
      alternatives: subject.scores.slice(0, 3).map((s) => ({ label: s.label, confidence: s.confidence })),
      uncertain: true,
      notLeaf: false,
      needsFollowUp: true,
      modelVersion: MODEL_VERSION,
      isMock: false,
    };
  }

  // 4. Leaf photo: run the 7-class Leaf CNN
  if (!isReady || !cnnModel) {
    if (ALLOW_MOCK && process.env.NODE_ENV !== 'production') {
      return {
        subjectType: 'grape_leaf',
        subjectLabel: 'Grape Leaf',
        subjectConfidence: 0.95,
        prediction: 'Powdery Mildew',
        predictionKey: 'powdery_mildew',
        confidence: 0.88,
        alternatives: [{ label: 'Powdery Mildew', confidence: 0.88 }, { label: 'Healthy', confidence: 0.07 }],
        uncertain: false,
        notLeaf: false,
        needsFollowUp: false,
        modelVersion: 'mock',
        isMock: true,
      };
    }
    return null;
  }

  let tensor;
  try {
    const { data, info } = await sharp(imagePath, { failOn: 'none' })
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgbData = new Float32Array(info.width * info.height * 3);
    for (let i = 0; i < rgbData.length; i++) rgbData[i] = data[i] / 255.0;

    tensor = tf.tensor3d(rgbData, [info.height, info.width, 3])
      .resizeBilinear([224, 224])
      .expandDims(0);

    let probs = Array.from(await cnnModel.predict(tensor).data());

    if (CNN_TEMPERATURE !== 1) {
      const scaled = probs.map((p) => Math.pow(Math.max(p, 1e-12), 1 / CNN_TEMPERATURE));
      const sum = scaled.reduce((a, b) => a + b, 0);
      probs = scaled.map((p) => p / sum);
    }

    const ranked = probs
      .map((p, i) => ({ label: formatClassName(LEAF_CLASSES[i]), key: LEAF_CLASSES[i], confidence: p }))
      .sort((a, b) => b.confidence - a.confidence);
    const top = ranked[0];

    return {
      subjectType: 'grape_leaf',
      subjectLabel: 'Grape Leaf',
      subjectConfidence: subject.subjectConfidence,
      prediction: top.label,
      predictionKey: top.key,
      confidence: top.confidence,
      alternatives: ranked.slice(0, 3).map(({ label, confidence }) => ({ label, confidence })),
      uncertain: top.confidence < UNCERTAIN_BELOW,
      notLeaf: top.confidence < NOT_LEAF_BELOW,
      needsFollowUp: top.confidence < UNCERTAIN_BELOW,
      modelVersion: MODEL_VERSION,
      isMock: false,
    };
  } catch (error) {
    console.error('❌ Error during image analysis:', error);
    throw new Error('Image analysis failed: unsupported or corrupt image');
  } finally {
    if (tensor) tensor.dispose();
  }
}

function formatClassName(className) {
  return className
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
