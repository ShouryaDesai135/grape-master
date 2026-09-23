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
    // Use gemini-2.5-flash for speed and lower cost while maintaining reasoning quality
    model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
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

  // 5. Construct the strict RAG system prompt
  const prompt = `
You are Grape Master, an expert agricultural advisory AI for grape farmers.
You MUST answer the farmer's question based ONLY on the provided context below.
Do NOT use your general knowledge. If the context does not contain the answer, politely say you don't have that specific information and advise them to consult a local agronomist.

=== PREVIOUS CONVERSATION HISTORY ===
${historyString || 'No previous history.'}

=== RETRIEVED FACTUAL CONTEXT ===
${contextString || 'No relevant context found.'}${cnnString}

=== FARMER'S CURRENT QUESTION ===
Farmer: ${userQuery}

=== INSTRUCTIONS ===
1. Answer the question in **${targetLanguage}**.
2. Be conversational, respectful, and direct.
3. If an image diagnosis is provided, weave it naturally into your advice.
4. Keep the answer structured (use short paragraphs or bullet points if appropriate).
5. Base all advice strictly on the "RETRIEVED FACTUAL CONTEXT".
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
 * Concatenates the best retrieved chunks into a readable string.
 */
function structuredFallback(chunks, cnnResult, language) {
  let response = '';

  if (cnnResult) {
    const cnnText = {
      en: `System Diagnosis: ${cnnResult.prediction} (${(cnnResult.confidence * 100).toFixed(1)}% confidence).\n\n`,
      hi: `सिस्टम निदान: ${cnnResult.prediction} (${(cnnResult.confidence * 100).toFixed(1)}% आत्मविश्वास)।\n\n`,
      mr: `सिस्टम निदान: ${cnnResult.prediction} (${(cnnResult.confidence * 100).toFixed(1)}% आत्मविश्वास).\n\n`
    };
    response += cnnText[language] || cnnText.en;
  }

  if (chunks.length === 0) {
    const noInfo = {
      en: "I'm sorry, I don't have specific information about that in my knowledge base.",
      hi: "क्षमा करें, मेरे ज्ञानकोष में इसके बारे में विशिष्ट जानकारी नहीं है।",
      mr: "क्षमस्व, माझ्या ज्ञानकोषात याबद्दल विशिष्ट माहिती नाही."
    };
    return response + (noInfo[language] || noInfo.en);
  }

  // Just return the answer from the highest scoring chunk
  const bestMatch = chunks[0];
  return response + bestMatch.answer;
}
