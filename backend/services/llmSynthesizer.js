/**
 * llmSynthesizer.js — LLM Response Generator
 * ══════════════════════════════════════════
 * 
 * Uses Google Gemini API (gemini-1.5-flash) to synthesize natural, 
 * conversational responses from the retrieved RAG context chunks.
 * 
 * PRD Constraint: The system MUST answer from retrieved context,
 * not from its own general knowledge.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;
let model = null;

/**
 * Initialize the Gemini client if an API key is available.
 */
export function initLLM() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.warn('⚠️ GEMINI_API_KEY not found in .env. LLM Synthesizer will use structural fallback mode.');
    return;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-1.5-flash for speed and reliability
    model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2, // Low temperature for grounded RAG (less hallucination)
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      }
    });
    console.log('✅ Google Gemini LLM initialized.');
  } catch (error) {
    console.error('❌ Failed to initialize Gemini:', error);
  }
}

/**
 * Synthesize a response using Gemini based ONLY on the retrieved chunks.
 * 
 * @param {string} userQuery - The farmer's question
 * @param {Array} retrievedChunks - Array of objects from vectorStore
 * @param {string} language - Target language (en, hi, mr)
 * @param {Array} conversationContext - Previous turns in this session
 * @param {Object} cnnResult - Optional image diagnosis results
 * @returns {string} The synthesized natural language response
 */
export async function synthesizeResponse(userQuery, retrievedChunks, language, conversationContext = [], cnnResult = null) {
  // If no Gemini key, fallback to a structured concatenation
  if (!model) {
    return structuredFallback(retrievedChunks, cnnResult, language);
  }

  // 1. Format the context from retrieved chunks
  const contextString = retrievedChunks.map((chunk, i) => 
    `[Source ${i+1}] Q: ${chunk.question}\nA: ${chunk.answer}`
  ).join('\n\n');

  // 2. Format previous conversation context (up to last 3 turns)
  const historyString = conversationContext.slice(-3).map(turn => 
    `${turn.role === 'farmer' ? 'Farmer' : 'Assistant'}: ${turn.canonical}`
  ).join('\n');

  // 3. Format CNN diagnosis if present
  let cnnString = '';
  if (cnnResult) {
    cnnString = `\nIMAGE DIAGNOSIS: The system analyzed an uploaded photo and diagnosed: ${cnnResult.prediction} with ${(cnnResult.confidence * 100).toFixed(1)}% confidence.`;
  }

  // 4. Determine language name for prompt
  const langMap = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
  const targetLanguage = langMap[language] || 'English';

  // 5. Construct the simplified, farmer-friendly RAG system prompt
  const prompt = `
You are Grape Master, a helpful and friendly agricultural advisory assistant for grape farmers.
Your job is to take the retrieved facts below and explain them in very simple, easy-to-understand language.

=== PREVIOUS CONVERSATION HISTORY ===
${historyString || 'No previous history.'}

=== RETRIEVED FACTUAL CONTEXT ===
${contextString || 'No relevant context found.'}${cnnString}

=== FARMER'S CURRENT QUESTION ===
Farmer: ${userQuery}

=== STRICT FORMATTING INSTRUCTIONS ===
1. Respond ONLY in **${targetLanguage}**.
2. Keep sentences short, friendly, and practical. Avoid complex scientific jargon.
3. Structure your response clearly using these 3 simple bullet points:
   • 🔍 **Diagnosis / Overview:** (1 short sentence explaining the issue)
   • 💊 **Recommended Treatment:** (Exact spray dosage or step-by-step action)
   • 🛡️ **Prevention Tip:** (1 simple tip to protect the vineyard)
4. Base all chemical names and dosages STRICTLY on the RETRIEVED FACTUAL CONTEXT. Do not invent doses.
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ LLM Generation Error:', error);
    // Graceful degradation: fallback to structured text if API fails
    return structuredFallback(retrievedChunks, cnnResult, language);
  }
}

/**
 * Fallback mode when Gemini API is unavailable or errors out.
 * Formats retrieved chunks into clean, simple bullet points.
 */
function structuredFallback(chunks, cnnResult, language) {
  let response = '';

  if (cnnResult) {
    const diseaseName = cnnResult.prediction.replace(/_/g, ' ').toUpperCase();
    const pct = (cnnResult.confidence * 100).toFixed(0);
    const cnnText = {
      en: `🌿 **Leaf Diagnosis:** Our AI scanned your leaf image and detected **${diseaseName}** with **${pct}% confidence**.\n\n`,
      hi: `🌿 **पत्ती का निदान:** हमारे AI ने आपकी पत्ती का विश्लेषण किया और **${pct}% विश्वास** के साथ **${diseaseName}** पाया।\n\n`,
      mr: `🌿 **पानाची पाहणी:** आमच्या AI ने तुमच्या पानाचे विश्लेषण केले असून **${pct}% खात्रीने** **${diseaseName}** चे निदान झाले आहे.\n\n`
    };
    response += cnnText[language] || cnnText.en;
  }

  if (chunks.length === 0) {
    const noInfo = {
      en: "I'm sorry, I don't have specific advice for that in my knowledge base. Please consult your local viticulture expert.",
      hi: "क्षमा करें, मेरे ज्ञानकोष में इसके बारे में विशिष्ट जानकारी नहीं है। कृपया स्थानीय कृषि विशेषज्ञ से संपर्क करें।",
      mr: "क्षमस्व, माझ्या ज्ञानकोषात याबद्दल विशिष्ट माहिती नाही. कृपया स्थानिक कृषी तज्ञांचा सल्ला घ्या."
    };
    return response + (noInfo[language] || noInfo.en);
  }

  // Return highest scoring chunk formatted cleanly
  const topChunk = chunks[0];
  return response + `• 🔍 **Answer:** ${topChunk.answer}`;
}

const LANG_NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

/**
 * Authentically translate farmer-facing text with Gemini.
 * Tuned for Indian grape-farming vocabulary (en / hi / mr).
 * Returns an array of translated strings in the same order as `texts`.
 */
export async function translateTexts(texts = [], targetLanguage = 'en') {
  const target = LANG_NAMES[targetLanguage] || 'English';
  const cleaned = (texts || []).map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);

  if (cleaned.length === 0) return [];

  // No model → return originals (UI still switches via static i18n)
  if (!model) {
    return cleaned;
  }

  const prompt = `You are a professional agricultural translator for Indian grape farmers (Maharashtra / Nashik belt).

Translate each numbered text into natural, spoken ${target}.
Rules:
- Sound like a local farm advisor speaking to a farmer — warm, clear, practical.
- Keep spray doses, chemical names, NPK ratios, variety names, and units unchanged.
- Prefer common farmer terms (e.g. भुरी / केवडा / छाटणी in Marathi; फफूंदी / छंटाई in Hindi) when they fit.
- Do NOT add extra advice. Translate only.
- Return ONLY a JSON array of strings, same length and order as the input. No markdown.

Texts:
${cleaned.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  try {
    const result = await model.generateContent(prompt);
    const raw = (await result.response).text().trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return cleaned;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length !== cleaned.length) return cleaned;
    return parsed.map((item, i) => (typeof item === 'string' && item.trim() ? item.trim() : cleaned[i]));
  } catch (error) {
    console.error('❌ Translation Error:', error);
    return cleaned;
  }
}

export async function translateText(text, targetLanguage = 'en') {
  const [out] = await translateTexts([text], targetLanguage);
  return out || text;
}
