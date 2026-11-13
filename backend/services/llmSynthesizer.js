/**
 * llmSynthesizer.js — LLM Response Generator (provider-agnostic)
 * ══════════════════════════════════════════════════════════════
 *
 * Providers (select with LLM_PROVIDER=gemini|groq; auto-detected from available keys):
 *   - gemini : Google Gemini via @google/generative-ai   (GEMINI_API_KEY, GEMINI_MODEL)
 *   - groq   : Groq OpenAI-compatible REST API           (GROQ_API_KEY,  GROQ_MODEL)
 *
 * Model names are configurable because hosted model lines are retired over time.
 * For Gemini we try a fallback list when a model returns 404/not-found.
 *
 * PRD constraint: answer ONLY from retrieved context, never invent doses.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash',
].filter(Boolean);

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const GENERATION = { temperature: 0.2, topK: 40, topP: 0.95, maxOutputTokens: 1024 };

let provider = null;       // 'gemini' | 'groq' | null
let genAI = null;
let activeGeminiModel = null;
let lastError = null;

export function getLLMInfo() {
  return { provider, model: provider === 'groq' ? GROQ_MODEL : activeGeminiModel, lastError };
}

export function isLLMAvailable() {
  return provider !== null;
}

/**
 * Initialize the configured LLM provider. Never throws: on failure the app uses the structured fallback.
 */
export function initLLM() {
  const wanted = (process.env.LLM_PROVIDER || '').toLowerCase();
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
  const hasGroq = !!process.env.GROQ_API_KEY?.trim();

  if (wanted === 'groq' || (!wanted && !hasGemini && hasGroq)) {
    if (!hasGroq) { console.warn('⚠️ LLM_PROVIDER=groq but GROQ_API_KEY is missing. Using structural fallback mode.'); return; }
    provider = 'groq';
    console.log(`✅ Groq LLM configured (${GROQ_MODEL}).`);
    return;
  }

  if (!hasGemini) {
    console.warn('⚠️ No GEMINI_API_KEY / GROQ_API_KEY found. LLM Synthesizer will use structural fallback mode.');
    return;
  }

  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
    activeGeminiModel = GEMINI_MODELS[0];
    provider = 'gemini';
    console.log(`✅ Google Gemini LLM configured (${activeGeminiModel}).`);
  } catch (error) {
    console.error('❌ Failed to initialize Gemini:', error);
  }
}

async function callGemini(prompt) {
  let lastErr;
  const tried = [];
  const order = [activeGeminiModel, ...GEMINI_MODELS.filter((m) => m !== activeGeminiModel)];
  for (const name of order) {
    tried.push(name);
    try {
      const model = genAI.getGenerativeModel({ model: name, generationConfig: GENERATION });
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();
      if (name !== activeGeminiModel) {
        console.warn(`ℹ️ Gemini model switched ${activeGeminiModel} -> ${name}`);
        activeGeminiModel = name;
      }
      return text;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const notFound = /404|not found|no longer available|is not supported/i.test(msg);
      if (!notFound) throw err; // network/auth/quota errors: do not cycle models
    }
  }
  throw new Error(`No Gemini model available (tried ${tried.join(', ')}): ${lastErr?.message}`);
}

async function callGroq(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY.trim()}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: GENERATION.temperature,
      max_tokens: GENERATION.maxOutputTokens,
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** Single entry point for every LLM call in the app. Throws on failure. */
export async function generateText(prompt) {
  if (!provider) throw new Error('LLM not configured');
  try {
    const text = provider === 'groq' ? await callGroq(prompt) : await callGemini(prompt);
    lastError = null;
    return text;
  } catch (err) {
    lastError = String(err?.message || err).slice(0, 300);
    throw err;
  }
}

const LANG_NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

/**
 * Synthesize a response from retrieved chunks only.
 *
 * @param {string} userQuery
 * @param {Array}  retrievedChunks
 * @param {string} language  en | hi | mr
 * @param {Array}  conversationContext previous turns
 * @param {Object} cnnResult optional image diagnosis ({prediction, confidence, alternatives})
 * @param {Object} farmerContext optional { variety, pruningType, daysAfterPruning, region }
 */
export async function synthesizeResponse(userQuery, retrievedChunks, language, conversationContext = [], cnnResult = null, farmerContext = {}) {
  if (!provider) {
    return structuredFallback(retrievedChunks, cnnResult, language);
  }

  const contextString = retrievedChunks
    .map((chunk, i) => `[Source ${i + 1}] Q: ${chunk.question}\nA: ${chunk.answer}`)
    .join('\n\n');

  const historyString = conversationContext
    .slice(-3)
    .map((turn) => `${turn.role === 'farmer' ? 'Farmer' : 'Assistant'}: ${turn.canonical}`)
    .join('\n');

  let cnnString = '';
  if (cnnResult) {
    if (cnnResult.notLeaf || cnnResult.subjectType === 'other') {
      cnnString = `\nIMAGEGATE: Uploaded photo is NOT a grape leaf, fruit, pest, or soil (detected: ${cnnResult.subjectLabel || 'unrelated object'}). Politely ask the farmer to upload a clear crop photo.`;
    } else if (['grape_berries', 'insect_pest', 'soil'].includes(cnnResult.subjectType)) {
      cnnString = `\nIMAGE SUBJECT TRIAGE: Photo shows **${cnnResult.subjectLabel}** (auto-diagnosis skipped for safety; queued for expert review). Provide provisional guidance ONLY from the farmer's text & retrieved context, and end with 2-3 diagnostic follow-up questions about symptoms, crop stage, and spread.`;
    } else {
      const alt = (cnnResult.alternatives || [])
        .slice(0, 2)
        .map((a) => `${a.label} ${(a.confidence * 100).toFixed(0)}%`)
        .join(', ');
      cnnString = `\nIMAGE DIAGNOSIS: leaf photo analysed -> ${cnnResult.prediction} (${(cnnResult.confidence * 100).toFixed(1)}% certainty)${alt ? `; other possibilities: ${alt}` : ''}.`;
    }
  }

  const ctxLines = [];
  if (farmerContext.variety) ctxLines.push(`Variety: ${farmerContext.variety}`);
  if (farmerContext.pruningType) ctxLines.push(`Pruning type: ${farmerContext.pruningType}`);
  if (farmerContext.daysAfterPruning != null) ctxLines.push(`Days since pruning: ${farmerContext.daysAfterPruning}`);
  if (farmerContext.region) ctxLines.push(`Region: ${farmerContext.region}`);
  const farmerString = ctxLines.length ? `\n=== FARMER PROFILE ===\n${ctxLines.join('\n')}\n` : '';

  const targetLanguage = LANG_NAMES[language] || 'English';

  const prompt = `
You are Grape Master, a friendly agricultural advisory assistant for grape farmers in Maharashtra, India.
Explain the retrieved facts below in very simple language.

=== PREVIOUS CONVERSATION HISTORY ===
${historyString || 'No previous history.'}
${farmerString}
=== RETRIEVED FACTUAL CONTEXT ===
${contextString || 'No relevant context found.'}${cnnString}

=== FARMER'S CURRENT QUESTION ===
Farmer: ${userQuery}

=== STRICT RULES ===
1. Respond ONLY in **${targetLanguage}**. Keep sentences short and practical.
2. Use ONLY the RETRIEVED FACTUAL CONTEXT for diagnosis, chemical names and doses. NEVER invent or adjust a dose.
3. If the context does not contain the information needed (or a dose), say clearly that the exact detail is not available and advise confirming with a local agriculture expert. Do not guess.
4. If the context is about a different crop stage or variety than the farmer's profile, mention that the advice must be adjusted/confirmed.
5. If an IMAGE DIAGNOSIS is given and its certainty is below 60%, mention that the photo result is uncertain and name the other possibilities.
6. Structure the answer with these 3 bullets:
   • 🔍 **Diagnosis / Overview:** (1 short sentence)
   • 💊 **Recommended Treatment:** (exact spray dosage or step-by-step action from the context)
   • 🛡️ **Prevention Tip:** (1 simple tip)
7. For any chemical recommendation end with one line reminding the farmer to follow the label and confirm with a local expert.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error('❌ LLM Generation Error:', error.message);
    return structuredFallback(retrievedChunks, cnnResult, language);
  }
}

/**
 * Rewrite a short follow-up into a standalone query using recent turns.
 * Uses the LLM when available, otherwise returns null (caller applies a rule-based rewrite).
 */
export async function rewriteFollowUp(query, conversationContext = []) {
  if (!provider || conversationContext.length === 0) return null;
  const history = conversationContext
    .slice(-4)
    .map((t) => `${t.role === 'farmer' ? 'Farmer' : 'Assistant'}: ${String(t.canonical).slice(0, 300)}`)
    .join('\n');
  const prompt = `Rewrite the farmer's last message as ONE standalone search query (same language as the message, include the crop disease/topic from the history). Output only the query.\n\nHistory:\n${history}\n\nLast message: ${query}\n\nStandalone query:`;
  try {
    const out = (await generateText(prompt)).trim().split('\n')[0];
    return out && out.length < 300 ? out : null;
  } catch {
    return null;
  }
}

const SUBJECT_FOLLOWUPS = {
  grape_berries: {
    en: `\n\n📋 **To give you an exact spray/treatment for your grape bunch, please tell us:**\n1. Do you see powdery dust that wipes off easily (Powdery Mildew) or waxy white cottony clusters inside the bunch (Mealybug)?\n2. Are the berries cracking, shriveling, or showing rusty brown scars (Thrips)?\n3. How many days since fruit pruning, and what is the berry size (mm)?`,
    mr: `\n\n📋 **द्राक्ष घडावर अचूक उपाय सांगण्यासाठी कृपया खालील माहिती द्या:**\n१. मण्यांवर पुसली जाणारी पांढरी पावडर (भुरी) आहे की घडाच्या देठात पांढरे चिकट पुंजके (मिलीबग) आहेत?\n२. मणी तडकत आहेत, सुकत आहेत की त्यावर तांबूस खरचटल्यासारखे डाग (थ्रिप्स) आहेत?\n३. गोडी बहार छाटणी होऊन किती दिवस झाले आणि मण्यांची साईज किती आहे?`,
    hi: `\n\n📋 **अंगूर के गुच्छे के सटीक उपचार के लिए कृपया बताएं:**\n1. क्या दानों पर आसानी से हटने वाला सफेद पाउडर (फफूंदी/भुरी) है या गुच्छे के अंदर सफेद रुई जैसे कीट (मिलीबग) हैं?\n2. क्या दाने फट रहे हैं या उन पर भूरे निशान (थ्रिप्स) हैं?\n3. फल छंटाई के कितने दिन हुए हैं?`,
  },
  insect_pest: {
    en: `\n\n📋 **To confirm the pest and safe insecticide dose, please clarify:**\n1. Where is the pest located (young shoot tips, underside of leaves, or inside the berry cluster)?\n2. Are young leaves curling upwards/downwards (Thrips/Jassids) or covered in sticky honeydew/sooty mold (Mealybug)?\n3. What is your current vineyard growth stage?`,
    mr: `\n\n📋 **कीड आणि योग्य कीटकनाशक निश्चित करण्यासाठी कृपया सांगा:**\n१. कीड नेमकी कुठे दिसतेय (कोवळ्या शेंड्यावर, पानांच्या खाली की घडामध्ये)?\n२. कोवळी पाने वाकडी/बोकड्यासारखी होत आहेत (थ्रिप्स/तुडतुडे) की चिकट पदार्थ व काळी बुरशी (मिलीबग) दिसत आहे?\n३. सध्या बागेची अवस्था कोणती आहे?`,
    hi: `\n\n📋 **कीट की पहचान और सही दवा के लिए कृपया बताएं:**\n1. कीट कहाँ दिख रहे हैं (नई पत्तियों पर, पत्ते के नीचे या गुच्छे के अंदर)?\n2. क्या नई पत्तियां मुड़ रही हैं (थ्रिप्स) या चिपचिपा पदार्थ दिख रहा है (मिलीबग)?\n3. अभी बाग किस अवस्था में है?`,
  },
  soil: {
    en: `\n\n📋 **Soil color from a phone camera cannot replace a soil test. For accurate fertilizer advice, please share:**\n1. What is your soil type — Black Cotton (heavy), Red/Murmad (medium/light), or Calcareous (Chunam/limestone)?\n2. How many days since April/October pruning, and what is your grape variety?\n3. Do you have a recent soil or petiole test report (pH, EC, NPK)?`,
    mr: `\n\n📋 **फोटोवरून मातीचा अचूक प्रकार ठरवून खताचा डोस देणे धोक्याचे ठरू शकते. कृपया खालील माहिती द्या:**\n१. तुमच्या बागेची जमीन कोणती आहे — काळी कसदार, तांबडी/मुरमाड की चुनखडीयुक्त?\n२. छाटणी होऊन किती दिवस झाले आहेत आणि द्राक्ष जातीचे नाव काय आहे?\n३. पानांवर पिवळेपणा (लोह/मॅग्नेशियम कमतरता) किंवा पाणी साचण्याची समस्या आहे का?`,
    hi: `\n\n📋 **केवल फोटो से मिट्टी की जांच कर खाद की मात्रा तय करना सुरक्षित नहीं है। कृपया बताएं:**\n1. आपकी मिट्टी किस प्रकार की है — काली मिट्टी, लाल/मुरम मिट्टी या चूनायुक्त (चुनखडी)?\n2. छंटाई के कितने दिन हो चुके हैं और अंगूर की किस्म कौन सी है?\n3. क्या पत्तियों में पीलापन या जलभराव की समस्या है?`,
  },
};

export function getSubjectFollowUpQuestions(subjectType, language = 'en') {
  const entry = SUBJECT_FOLLOWUPS[subjectType];
  if (!entry) return '';
  return entry[language] || entry.en;
}

/**
 * Fallback when no LLM is available or it errors out.
 * Always formats retrieved chunks into the structured 3-bullet advisory format (PDF §1)
 * and appends safe triage follow-up questions for non-leaf subjects.
 */
export function structuredFallback(chunks, cnnResult, language = 'en') {
  const labels = {
    en: {
      diag: '• 🔍 **Diagnosis / Overview:**',
      treat: '• 💊 **Recommended Treatment / Action:**',
      prev: '• 🛡️ **Prevention & Safety Tip:**',
      safety: 'Always follow the product label and confirm dosages with your local viticulture expert.',
    },
    mr: {
      diag: '• 🔍 **निदान / आढावा:**',
      treat: '• 💊 **शिफारस केलेली फवारणी / उपाय:**',
      prev: '• 🛡️ **प्रतिबंधात्मक काळजी व टीप:**',
      safety: 'कोणतीही रासायनिक फवारणी घेताना प्रमाण तपासावे व स्थानिक कृषी तज्ञांचा सल्ला घ्यावा.',
    },
    hi: {
      diag: '• 🔍 **निदान / अवलोकन:**',
      treat: '• 💊 **अनुशंसित उपचार / छिड़काव:**',
      prev: '• 🛡️ **बचाव और सुरक्षा टिप:**',
      safety: 'किसी भी रासायनिक दवा का छिड़काव करने से पहले स्थानीय कृषि विशेषज्ञ से पुष्टि अवश्य करें।',
    },
  };
  const L = labels[language] || labels.en;

  // 1. Handle non-crop / unrelated image uploads cleanly
  if (cnnResult?.notLeaf || cnnResult?.subjectType === 'other') {
    const notCropMsg = {
      en: `${L.diag} The uploaded image does not appear to be a grape leaf, fruit bunch, pest, or vineyard soil.\n${L.treat} Please upload a clear, well-lit close-up photo of the affected vine leaf, grape bunch, or pest.\n${L.prev} ${chunks[0]?.answer || L.safety}`,
      mr: `${L.diag} तुम्ही पाठवलेला फोटो द्राक्षाचे पान, घड, कीड किंवा मातीचा वाटत नाही.\n${L.treat} कृपया रोगग्रस्त पानाचा, घडाचा किंवा किडीचा स्पष्ट आणि जवळून काढलेला फोटो अपलोड करा.\n${L.prev} ${chunks[0]?.answer || L.safety}`,
      hi: `${L.diag} अपलोड की गई तस्वीर अंगूर की पत्ती, गुच्छे, कीट या मिट्टी की नहीं लग रही है।\n${L.treat} कृपया प्रभावित पत्ती, गुच्छे या कीट की स्पष्ट फोटो अपलोड करें।\n${L.prev} ${chunks[0]?.answer || L.safety}`,
    };
    return notCropMsg[language] || notCropMsg.en;
  }

  // 2. Build Overview line from CNN or Subject Gate
  let overviewLine = '';
  if (cnnResult) {
    if (['grape_berries', 'insect_pest', 'soil'].includes(cnnResult.subjectType)) {
      const subjNotice = {
        en: `Photo identified as **${cnnResult.subjectLabel}** (queued for agronomist review; provisional guidance below based on your query).`,
        mr: `फोटो **${cnnResult.subjectLabel}** म्हणून ओळखला गेला आहे (तज्ञांच्या पडताळणीसाठी पाठवला आहे; तुमच्या प्रश्नानुसार प्राथमिक मार्गदर्शन खालीलप्रमाणे).`,
        hi: `फोटो की पहचान **${cnnResult.subjectLabel}** के रूप में हुई है (कृषि विशेषज्ञ की समीक्षा हेतु भेजा गया है; आपके प्रश्न के आधार पर प्राथमिक जानकारी नीचे दी गई है)।`,
      };
      overviewLine = subjNotice[language] || subjNotice.en;
    } else {
      const diseaseName = String(cnnResult.prediction).replace(/_/g, ' ');
      const pct = (cnnResult.confidence * 100).toFixed(0);
      const cnnText = {
        en: `Leaf vision scan detected **${diseaseName}** (${pct}% certainty).`,
        hi: `पत्ती की जांच में **${pct}% संभावना** के साथ **${diseaseName}** के लक्षण दिखे हैं।`,
        mr: `पानाच्या तपासणीत **${pct}% खात्रीने** **${diseaseName}** चे निदान झाले आहे.`,
      };
      overviewLine = cnnText[language] || cnnText.en;
    }
  }

  // 3. If no chunks retrieved
  if (!chunks || chunks.length === 0) {
    const noInfo = {
      en: `${L.diag} ${overviewLine || 'Query received for expert review.'}\n${L.treat} I don't have a verified dosage match for this specific query in my knowledge base yet.\n${L.prev} ${L.safety}`,
      hi: `${L.diag} ${overviewLine || 'आपका प्रश्न विशेषज्ञ समीक्षा के लिए दर्ज किया गया है।'}\n${L.treat} क्षमा करें, मेरे ज्ञानकोष में इसके लिए सटीक मात्रा उपलब्ध नहीं है।\n${L.prev} ${L.safety}`,
      mr: `${L.diag} ${overviewLine || 'तुमचा प्रश्न तज्ञांच्या पाहणीसाठी नोंदवला आहे.'}\n${L.treat} क्षमस्व, माझ्या ज्ञानकोषात याबद्दल अचूक फवारणी/प्रमाण उपलब्ध नाही.\n${L.prev} ${L.safety}`,
    };
    return (noInfo[language] || noInfo.en) + getSubjectFollowUpQuestions(cnnResult?.subjectType, language);
  }

  // 4. Construct 3-bullet structured response from retrieved chunks
  const primaryAnswer = chunks[0].answer.trim();
  const secondaryTip = chunks[1]?.answer ? chunks[1].answer.trim().split('\n')[0] : L.safety;
  const diagSummary = overviewLine || chunks[0].question;

  const bullets = [
    `${L.diag} ${diagSummary}`,
    `${L.treat} ${primaryAnswer}`,
    `${L.prev} ${secondaryTip !== primaryAnswer ? `${secondaryTip} (${L.safety})` : L.safety}`,
  ].join('\n\n');

  return bullets + getSubjectFollowUpQuestions(cnnResult?.subjectType, language);
}

/**
 * Translate farmer-facing text. Returns originals when no LLM is available.
 * Returns an array of translated strings in the same order as `texts`.
 */
export async function translateTexts(texts = [], targetLanguage = 'en') {
  const target = LANG_NAMES[targetLanguage] || 'English';
  const cleaned = (texts || []).map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);

  if (cleaned.length === 0) return [];
  if (!provider) return cleaned;

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
    const raw = (await generateText(prompt)).trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return cleaned;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length !== cleaned.length) return cleaned;
    return parsed.map((item, i) => (typeof item === 'string' && item.trim() ? item.trim() : cleaned[i]));
  } catch (error) {
    console.error('❌ Translation Error:', error.message);
    return cleaned;
  }
}

export async function translateText(text, targetLanguage = 'en') {
  const [out] = await translateTexts([text], targetLanguage);
  return out || text;
}
