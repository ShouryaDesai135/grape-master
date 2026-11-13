/**
 * nlp.js — Multilingual NLP Toolkit for Farmer Queries
 * ═════════════════════════════════════════════════════
 *
 * 1. normalizeText              Unicode NFC, zero-width removal, Devanagari digits -> ASCII
 * 2. scrubPii                   Redacts mobile numbers, emails, and Aadhaar-like IDs (PDF §10)
 * 3. spellCorrectToken &
 *    correctGrammarAndSpelling  Real-time typo/spell correction (Damerau-Levenshtein + Indic
 *                               phonetic skeleton) + multilingual grammar normalization
 *                               for English, Marathi, Hindi, and Romanized Hinglish/Marathi
 * 4. expandQuery                Romanized / code-mixed farmer vocabulary -> canonical
 *                               English + Marathi + Hindi terms (improves retrieval & BM25)
 * 5. tokenize & stem            Stop-word removal + light Marathi/Hindi suffix stripping
 * 6. detectLanguage             Script + marker scoring (with Devanagari tie-breaking)
 * 7. classifyIntent             Embedding nearest-centroid classifier over seed examples
 *                               (falls back to keyword rules if the embedder is unavailable)
 */

import { generateEmbedding } from './embeddingEngine.js';

// ───────────────────────── 1. Normalization & PII Scrubbing ─────────────────────────

const DEVANAGARI_DIGITS = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

export function normalizeText(text = '') {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')           // zero-width chars
    .replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d])   // Devanagari digits
    .replace(/[“”‘’]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Redact personal identifiable information (Indian mobile numbers, emails, 12-digit IDs)
 * before storing or logging queries (PDF §10 Data Privacy Compliance).
 */
export function scrubPii(text = '') {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[ID_REDACTED]')
    .replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '[PHONE_REDACTED]');
}

// ───────────────────────── 2. Glossary Expansion ─────────────────────────
// Each entry: variants (romanized / spelling variants) -> extra canonical terms appended to the query.

const GLOSSARY = [
  { v: ['bhuri', 'bhuree', 'powdery', 'safed fungus', 'पांढरी बुरशी'], add: 'भुरी powdery mildew सफेद फफूंदी' },
  { v: ['davni', 'dawani', 'davani', 'downy', 'kevda', 'keora', 'डाऊनी', 'डाउनी'], add: 'डाऊनी केवडा downy mildew' },
  { v: ['karpa', 'karapa', 'करपा'], add: 'करपा blight leaf blight' },
  { v: ['chatani', 'chhatani', 'chhantai', 'chatni'], add: 'छाटणी pruning छंटाई' },
  { v: ['kharad', 'kharad chatani'], add: 'खरड छाटणी foundation pruning' },
  { v: ['godi', 'godibahar', 'godi bahar'], add: 'गोडी बहार छाटणी fruit pruning' },
  { v: ['recut', 'rikat', 'ricut'], add: 'रिकट recut' },
  { v: ['khat', 'khad', 'khatache'], add: 'खत fertilizer खाद' },
  { v: ['pani', 'paani'], add: 'पाणी water irrigation' },
  { v: ['fawarni', 'favarni', 'phawarni', 'spray', 'chidkav'], add: 'फवारणी spray छिड़काव' },
  { v: ['aushadh', 'dawa', 'dava', 'औषध'], add: 'औषध medicine दवा' },
  { v: ['draksh', 'draksha', 'angur', 'grapes', 'grape'], add: 'द्राक्ष grape अंगूर' },
  { v: ['mani', 'mane'], add: 'मणी berry' },
  { v: ['ghad', 'ghadh'], add: 'घड bunch cluster गुच्छा' },
  { v: ['pan', 'pane', 'patte', 'patta'], add: 'पान leaf पत्ता' },
  { v: ['kid', 'keed', 'kida', 'kide'], add: 'कीड pest insect कीट' },
  { v: ['thrips', 'thripse', 'fulkide'], add: 'थ्रिप्स thrips फुलकिडे' },
  { v: ['mealybug', 'mealy', 'dhekun', 'pithya'], add: 'मिलीबग mealybug पिठ्या ढेकूण' },
  { v: ['udya', 'uddya', 'flea'], add: 'उडद्या flea beetle' },
  { v: ['phugvan', 'fugavan', 'fugwan', 'phugwan', 'phugavan'], add: 'फुगवण berry sizing' },
  { v: ['kalokhi', 'kalokhee'], add: 'काळोखी dark green leaf' },
  { v: ['kadi', 'kaddi', 'padhvata', 'pakvata'], add: 'काडी पक्वता cane maturity' },
  { v: ['dormex', 'cyanamide'], add: 'डॉर्मेक्स hydrogen cyanamide' },
  { v: ['gibrelik', 'ga3', 'gibberellic'], add: 'GA3 gibberellic acid जिब्रेलिक' },
  { v: ['cppu', 'sitofex'], add: 'CPPU फुगवण' },
  { v: ['basal', 'beshal'], add: 'बेसल डोस basal dose' },
  { v: ['shenkhat'], add: 'शेणखत FYM manure' },
  { v: ['bordo', 'bordeaux', 'bordeau'], add: 'बोर्डो Bordeaux mixture' },
  { v: ['petiole'], add: 'देठ petiole' },
  { v: ['rog', 'bimari', 'bimar'], add: 'रोग disease बीमारी' },
  { v: ['peela', 'pivla', 'pivle', 'yellow'], add: 'पिवळा yellow पीला' },
];

const GLOSSARY_INDEX = new Map();
for (const entry of GLOSSARY) {
  for (const v of entry.v) GLOSSARY_INDEX.set(v.toLowerCase(), entry.add);
}

/**
 * Append canonical multilingual terms for any recognised romanized / code-mixed word.
 * The original text is always preserved (we only add context).
 */
export function expandQuery(text = '') {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const additions = new Set();

  for (const w of words) {
    if (GLOSSARY_INDEX.has(w)) additions.add(GLOSSARY_INDEX.get(w));
  }
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (GLOSSARY_INDEX.has(phrase)) additions.add(GLOSSARY_INDEX.get(phrase));
  }
  return additions.size ? `${normalized} ${[...additions].join(' ')}` : normalized;
}

// ───────────────────────── 3. Spell, Typo & Grammar Correction ─────────────────────────

/**
 * Direct high-certainty typo map covering frequent English, Romanized Marathi/Hindi,
 * and Devanagari misspellings observed in farmer queries.
 */
const DIRECT_TYPO_MAP = new Map([
  // English disease & pest typos
  ['powdry', 'powdery'], ['powderi', 'powdery'], ['powdary', 'powdery'], ['poudery', 'powdery'],
  ['mildw', 'mildew'], ['mildeu', 'mildew'], ['mildu', 'mildew'], ['meldew', 'mildew'],
  ['downey', 'downy'], ['dawny', 'downy'], ['douny', 'downy'],
  ['bligth', 'blight'], ['blite', 'blight'],
  ['bactrial', 'bacterial'], ['bactirial', 'bacterial'],
  ['anthracnos', 'anthracnose'], ['anthraknose', 'anthracnose'],
  ['thripse', 'thrips'], ['thirps', 'thrips'], ['trips', 'thrips'],
  ['milybug', 'mealybug'], ['mealybag', 'mealybug'], ['millibug', 'mealybug'],
  // Chemicals & growth regulators
  ['gibrelik', 'gibberellic'], ['giberelic', 'gibberellic'], ['gibberelic', 'gibberellic'], ['gibrallic', 'gibberellic'],
  ['asid', 'acid'], ['acidd', 'acid'],
  ['fungiside', 'fungicide'], ['fungiide', 'fungicide'], ['fungcide', 'fungicide'],
  ['pestiside', 'pesticide'], ['insectiside', 'insecticide'],
  ['fertillizer', 'fertilizer'], ['fertilzer', 'fertilizer'], ['fertlizer', 'fertilizer'], ['fertiliser', 'fertilizer'],
  ['hexaconazol', 'hexaconazole'], ['myclobutnil', 'myclobutanil'], ['mancozb', 'mancozeb'],
  ['imidacloprd', 'imidacloprid'], ['carbendazm', 'carbendazim'], ['azoxystrobn', 'azoxystrobin'],
  ['sulfer', 'sulfur'], ['sulphur', 'sulfur'], ['bordeux', 'bordeaux'], ['bordo', 'bordeaux'],
  // General farming & English query words
  ['prunning', 'pruning'], ['prunig', 'pruning'],
  ['irigation', 'irrigation'], ['irrigaton', 'irrigation'],
  ['spary', 'spray'], ['spry', 'spray'], ['sparay', 'spray'],
  ['symtoms', 'symptoms'], ['simptoms', 'symptoms'], ['symptom', 'symptoms'],
  ['treatmnt', 'treatment'], ['tretment', 'treatment'],
  ['medicin', 'medicine'], ['medecine', 'medicine'],
  ['leavs', 'leaves'], ['leafs', 'leaves'],
  ['bunchs', 'bunches'], ['berrys', 'berries'],
  ['wht', 'what'], ['wat', 'what'], ['whch', 'which'], ['wen', 'when'], ['hw', 'how'],
  ['shuld', 'should'], ['shoud', 'should'], ['plz', 'please'], ['pls', 'please'],
  // Romanized Marathi / Hinglish canonicalization
  ['fawrni', 'fawarni'], ['phavrni', 'fawarni'], ['favrni', 'fawarni'],
  ['chhatni', 'chatani'], ['chtani', 'chatani'],
  ['drksha', 'draksha'], ['drksh', 'draksh'],
  // Devanagari Marathi / Hindi common farmer spelling errors
  ['कोनती', 'कोणती'], ['कोनता', 'कोणता'], ['कोनते', 'कोणते'],
  ['फवारनी', 'फवारणी'], ['फावरणी', 'फवारणी'],
  ['छाटनी', 'छाटणी'], ['छटणी', 'छाटणी'],
  ['पांढरि', 'पांढरी'], ['भूरी', 'भुरी'], ['भुरि', 'भुरी'],
  ['कराव', 'करावे'], ['द्याव', 'द्यावे'], ['घ्याव', 'घ्यावे'],
  ['किया', 'क्या'], ['कोनसा', 'कौन सा'], ['कोनसी', 'कौन सी'],
  ['फफुंदी', 'फफूंदी'], ['छिडकाव', 'छिड़काव'],
]);

/**
 * Canonical Latin vocabulary used for bounded edit-distance + phonetic spell checking.
 * We keep this focused on domain + common query vocabulary so valid farmer words are never mangled.
 */
const CANONICAL_LATIN_VOCAB = [
  'grape', 'grapes', 'vine', 'vines', 'vineyard', 'leaf', 'leaves', 'berry', 'berries', 'bunch', 'bunches',
  'shoot', 'shoots', 'cane', 'canes', 'root', 'roots', 'soil', 'petiole', 'flower', 'flowering', 'harvest',
  'powdery', 'powder', 'mildew', 'downy', 'blight', 'black', 'rot', 'bacterial', 'esca', 'anthracnose', 'healthy',
  'disease', 'diseases', 'symptom', 'symptoms', 'infection', 'fungus', 'fungal', 'spots', 'yellow', 'white',
  'brown', 'dry', 'curling', 'cracking', 'dropping', 'rotting', 'wilting',
  'thrips', 'mealybug', 'mite', 'mites', 'flea', 'beetle', 'caterpillar', 'borer', 'pest', 'pests', 'insect',
  'spray', 'spraying', 'fungicide', 'insecticide', 'pesticide', 'medicine', 'treatment', 'control', 'prevent',
  'prevention', 'organic', 'chemical', 'dose', 'dosage', 'schedule', 'application', 'mixture', 'solution',
  'sulfur', 'hexaconazole', 'myclobutanil', 'mancozeb', 'carbendazim', 'azoxystrobin', 'metalaxyl', 'cymoxanil',
  'captan', 'copper', 'oxychloride', 'bordeaux', 'imidacloprid', 'spinosad', 'fipronil', 'buprofezin',
  'trichoderma', 'bacillus', 'subtilis', 'neem', 'dormex', 'cyanamide', 'gibberellic', 'acid', 'cppu',
  'fertilizer', 'manure', 'compost', 'urea', 'potash', 'phosphorus', 'nitrogen', 'calcium', 'magnesium',
  'boron', 'zinc', 'ferrous', 'sulphate', 'micronutrient', 'basal', 'fertigation',
  'pruning', 'foundation', 'october', 'april', 'fruit', 'canopy', 'dipping', 'thinning', 'girdling', 'recut',
  'irrigation', 'water', 'watering', 'drip', 'moisture', 'weather', 'rain', 'humidity', 'temperature',
  'thompson', 'seedless', 'sonaka', 'tas', 'ganesh', 'sharad', 'nanasaheb', 'crimson', 'flame', 'clone',
  'what', 'which', 'when', 'where', 'how', 'much', 'many', 'should', 'can', 'give', 'apply', 'use', 'best',
  'after', 'before', 'days', 'stage', 'acre', 'liter', 'litre', 'gram', 'ml', 'ppm',
];

/**
 * Phonetic skeleton for fuzzy matching (handles ph/f, v/w, sh/s, c/k, vowel collapses).
 */
function phoneticKey(word) {
  return word
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/gh/g, 'g')
    .replace(/kh/g, 'k')
    .replace(/dh/g, 'd')
    .replace(/bh/g, 'b')
    .replace(/sh/g, 's')
    .replace(/chh/g, 'ch')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/c(?=[aou])/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/w/g, 'v')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
    .replace(/(?<!^)[aeiouy]+/g, '');
}

const PHONETIC_INDEX = new Map();
const VOCAB_SET = new Set(CANONICAL_LATIN_VOCAB);
for (const [, v] of DIRECT_TYPO_MAP) VOCAB_SET.add(v.toLowerCase());
for (const entry of GLOSSARY) {
  for (const v of entry.v) VOCAB_SET.add(v.toLowerCase());
}
for (const word of CANONICAL_LATIN_VOCAB) {
  const key = phoneticKey(word);
  if (!PHONETIC_INDEX.has(key)) PHONETIC_INDEX.set(key, []);
  PHONETIC_INDEX.get(key).push(word);
}

/**
 * Bounded Damerau-Levenshtein distance (considers adjacent transpositions as 1 edit).
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 2) return 3;

  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return dp[la][lb];
}

/**
 * Correct a single token if it has a character stutter, direct typo match,
 * or close phonetic / Damerau-Levenshtein match in the agricultural vocabulary.
 */
export function spellCorrectToken(rawToken) {
  if (!rawToken || rawToken.length < 3) return rawToken;

  // 1. Collapse 3+ repeated characters ("spraaaay" -> "spray", "पाणीीी" -> "पाणी")
  let token = rawToken.replace(/(.)\1{2,}/gu, '$1');
  const lower = token.toLowerCase();

  // Preserve Capitalization if original started with uppercase
  const preserveCase = (replacement) => {
    if (rawToken[0] >= 'A' && rawToken[0] <= 'Z' && rawToken.slice(1) === rawToken.slice(1).toLowerCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  };

  // 2. Direct known typo map (supports Latin & Devanagari)
  if (DIRECT_TYPO_MAP.has(lower)) {
    return preserveCase(DIRECT_TYPO_MAP.get(lower));
  }
  if (DIRECT_TYPO_MAP.has(token)) {
    return DIRECT_TYPO_MAP.get(token);
  }

  // 3. Skip if already in vocabulary, contains digits, or is Devanagari/non-Latin
  if (VOCAB_SET.has(lower) || ROMAN_MARATHI_SET.has(lower) || ROMAN_HINDI_SET.has(lower) || STOP_WORDS.has(lower)) {
    return token;
  }
  if (!/^[a-zA-Z]{4,}$/.test(token)) {
    return token;
  }

  // 4. Phonetic match + edit distance <= 2
  const pKey = phoneticKey(lower);
  const phoneticCandidates = PHONETIC_INDEX.get(pKey) || [];
  let bestWord = null;
  let bestDist = 3;

  for (const cand of phoneticCandidates) {
    const d = editDistance(lower, cand);
    if (d <= 2 && d < bestDist) {
      bestDist = d;
      bestWord = cand;
    }
  }
  if (bestWord) return preserveCase(bestWord);

  // 5. General Damerau-Levenshtein scan over CANONICAL_LATIN_VOCAB
  //    Allow distance 1 for words >= 4 chars, or distance 2 for words >= 7 chars sharing first letter
  const maxAllowed = lower.length >= 7 ? 2 : 1;
  for (const cand of CANONICAL_LATIN_VOCAB) {
    if (cand[0] !== lower[0]) continue;
    if (Math.abs(cand.length - lower.length) > maxAllowed) continue;
    const d = editDistance(lower, cand);
    if (d <= maxAllowed && d < bestDist) {
      bestDist = d;
      bestWord = cand;
    }
  }

  return bestWord ? preserveCase(bestWord) : token;
}

/**
 * Grammar rules applied after token-level spell correction.
 * Each rule has { pattern, replace, label } for transparent reporting.
 */
const GRAMMAR_RULES = [
  // Unit formatting normalization ("2ml/liter" -> "2 ml/L", "5gm/l" -> "5 g/L", "50ppm" -> "50 ppm")
  {
    pattern: /\b(\d+(?:\.\d+)?)\s*(?:ml|मि\.?ली\.?)\s*\/\s*(?:l|ltr|liter|litre|लिटर)\b/gi,
    replace: '$1 ml/L',
    type: 'unit',
  },
  {
    pattern: /\b(\d+(?:\.\d+)?)\s*(?:gm|g|gram|ग्रॅम)\s*\/\s*(?:l|ltr|liter|litre|लिटर)\b/gi,
    replace: '$1 g/L',
    type: 'unit',
  },
  {
    pattern: /\b(\d+(?:\.\d+)?)\s*(ml|g|gm|kg|ppm)\b/gi,
    replace: (_, num, unit) => `${num} ${unit.toLowerCase() === 'gm' ? 'g' : unit.toLowerCase()}`,
    type: 'unit',
  },

  // English subject-verb agreement & missing verbs in farmer queries
  { pattern: /\b(my\s+)?(grape\s+)?leaf\s+have\b/gi, replace: '$1$2leaves have', type: 'grammar' },
  { pattern: /\bleaves\s+has\b/gi, replace: 'leaves have', type: 'grammar' },
  { pattern: /\b(grape\s+)?vines?\s+have\s+got\b/gi, replace: '$1vines have', type: 'grammar' },
  { pattern: /\bgrapes\s+is\b/gi, replace: 'grapes are', type: 'grammar' },
  { pattern: /\b(my\s+)?(grape\s+)?leaves?\s+(white|yellow|brown|black)\s+(spot|spots|powder|patches)\b/gi, replace: '$1$2leaves have $3 $4', type: 'grammar' },
  { pattern: /\bwhite\s+spot\b/gi, replace: 'white spots', type: 'grammar' },
  { pattern: /\byellow\s+spot\b/gi, replace: 'yellow spots', type: 'grammar' },
  { pattern: /\bblack\s+spot\b/gi, replace: 'black spots', type: 'grammar' },

  // Broken interrogative / telegraphic question endings in English
  { pattern: /\bwhat\s+(?:to\s+)?spray\b/gi, replace: 'what should I spray', type: 'grammar' },
  { pattern: /\bwhich\s+(medicine|fungicide|spray|fertilizer)\s+(?:to\s+)?(use|give|apply)\b/gi, replace: 'which $1 should I $2', type: 'grammar' },
  { pattern: /\bhow\s+much\s+(dose|water|fertilizer)\s+(?:to\s+)?give\b/gi, replace: 'how much $1 should I give', type: 'grammar' },
  { pattern: /\bwhen\s+(?:to\s+)?do\s+(foundation\s+|fruit\s+)?pruning\b/gi, replace: 'when should I do $1pruning', type: 'grammar' },
  { pattern: /\bhow\s+to\s+control\s+it\b/gi, replace: 'how can I control it', type: 'grammar' },

  // Marathi & Hindi grammatical agreement fixes (use Unicode-safe boundaries, not ASCII \b)
  { pattern: /काय\s+कराव(?=[?\s।]|$)/g, replace: 'काय करावे', type: 'grammar' },
  { pattern: /कधी\s+कराव(?=[?\s।]|$)/g, replace: 'कधी करावे', type: 'grammar' },
  { pattern: /कोणती\s+फवारणी\s+घ्याव(?:े)?(?=[?\s।]|$)/g, replace: 'कोणती फवारणी घ्यावी', type: 'grammar' },
  { pattern: /पानावर\s+पांढरा\s+भुरी/g, replace: 'पानावर पांढरी भुरी', type: 'grammar' },
  { pattern: /अंगूर\s+के\s+पत्ते\s+पर\s+सफेद\s+धब्बे\s+है(?=[?\s।]|$)/g, replace: 'अंगूर के पत्तों पर सफेद धब्बे हैं', type: 'grammar' },
  { pattern: /कौन\s+सा\s+दवा(?=[?\s।]|$)/g, replace: 'कौन सी दवा', type: 'grammar' },
];

const QUESTION_STARTERS_EN = /^(what|which|when|where|why|how|can|should|is|are|do|does)\b/i;
const QUESTION_MARKERS_DEV = /(?:^|\s)(काय|कसे|कशी|कसा|कधी|कोणता|कोणती|कोणते|किती|का|क्या|कैसे|कब|कौन|कितना|कितनी)(?=\s|[?!।]|$)/;
const QUESTION_MARKERS_ROMAN = /\b(kay|kasa|kashi|kadhi|konta|konti|kiti|kya|kaise|kab|kitna|kaun)\b/i;

/**
 * Full real-time spelling, typo & grammatical error corrector for farmer queries.
 * Works across English, Marathi, Hindi, and Romanized Hinglish/Marathi in < 3 ms.
 *
 * @param {string} text
 * @param {string} [langHint] 'en' | 'mr' | 'hi'
 * @returns {{
 *   original: string,
 *   corrected: string,
 *   hasChanges: boolean,
 *   corrections: Array<{ from: string, to: string, type: 'spelling'|'grammar'|'unit' }>,
 *   detectedLanguage: { language: string, confidence: number, script: string },
 *   expandedQuery: string
 * }}
 */
export function correctGrammarAndSpelling(text = '', langHint = null) {
  const original = normalizeText(text);
  if (!original) {
    return {
      original: '',
      corrected: '',
      hasChanges: false,
      corrections: [],
      detectedLanguage: { language: langHint || 'en', confidence: 0, script: 'none' },
      expandedQuery: '',
    };
  }

  const corrections = [];

  // Step 1: Token-level spell & typo correction while preserving spacing & punctuation
  const parts = original.split(/([\p{L}\p{M}\p{N}]+)/u);
  const rebuiltParts = parts.map((part) => {
    if (!/^[\p{L}\p{M}\p{N}]+$/u.test(part)) return part;
    // Check if it's a fused number+unit like "2ml" -> handled by grammar rules
    if (/^\d+[a-zA-Z]+$/.test(part)) return part;
    const fixed = spellCorrectToken(part);
    if (fixed !== part) {
      corrections.push({ from: part, to: fixed, type: 'spelling' });
    }
    return fixed;
  });

  let working = rebuiltParts.join('');

  // Step 2: Phrase-level grammar & unit normalization rules
  for (const rule of GRAMMAR_RULES) {
    const before = working;
    working = working.replace(rule.pattern, rule.replace);
    if (working !== before) {
      corrections.push({ from: before, to: working, type: rule.type });
    }
  }

  // Step 3: Clean up repeated punctuation and add question mark if interrogative
  working = working.replace(/([?!.,])\1+/g, '$1').replace(/\s+([?!.,])/g, '$1').trim();

  const isQuestion =
    QUESTION_STARTERS_EN.test(working) ||
    QUESTION_MARKERS_DEV.test(working) ||
    QUESTION_MARKERS_ROMAN.test(working) ||
    /\b(what should|which .* should|how much|how can|when should)\b/i.test(working);

  if (isQuestion && !/[?!।]$/.test(working) && working.split(/\s+/).length >= 3) {
    working = `${working}?`;
  }

  // Step 4: Capitalize first letter for pure Latin sentences if needed
  if (/^[a-z]/.test(working) && !ROMAN_MARATHI_SET.has(working.split(/\s+/)[0].toLowerCase())) {
    const cap = working.charAt(0).toUpperCase() + working.slice(1);
    if (cap !== working && corrections.length > 0) {
      working = cap;
    }
  }

  const detectedLanguage = detectLanguage(working);
  const expandedQuery = expandQuery(working);

  return {
    original,
    corrected: working,
    hasChanges: working.toLowerCase() !== original.toLowerCase() || corrections.length > 0,
    corrections,
    detectedLanguage,
    expandedQuery,
  };
}

// ───────────────────────── 4. Tokenization & Stemming ─────────────────────────

const STOP_WORDS = new Set([
  // English
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'have', 'has', 'had', 'does', 'did', 'will',
  'would', 'should', 'could', 'can', 'may', 'might', 'must', 'shall', 'this', 'that', 'these', 'those', 'with', 'from',
  'into', 'about', 'after', 'before', 'between', 'through', 'during', 'without', 'within', 'there', 'their', 'they',
  'them', 'then', 'than', 'some', 'such', 'only', 'very', 'just', 'much', 'more', 'most', 'other', 'and', 'the', 'for',
  'are', 'was', 'were', 'you', 'your', 'our', 'any', 'not',
  // Marathi
  'आहे', 'आहेत', 'असून', 'असल्यास', 'साठी', 'कोणता', 'कोणती', 'कोणते', 'काय', 'कसे', 'कशी', 'कसा', 'करावे', 'करावा',
  'करावी', 'घ्यावा', 'घ्यावी', 'घ्यावे', 'झाले', 'झाला', 'झाली', 'होऊन', 'केले', 'केला', 'केली', 'माझ्या', 'आपल्या',
  'मध्ये', 'वरती', 'खाली', 'किती', 'कधी', 'येत', 'येते', 'आणि', 'किंवा', 'तर', 'पण', 'हे', 'ही', 'तो', 'ती',
  // Hindi
  'क्या', 'कैसे', 'कब', 'कहाँ', 'कौन', 'से', 'को', 'का', 'की', 'के', 'में', 'पर', 'है', 'हैं', 'था', 'थे', 'थी',
  'करें', 'करूँ', 'करना', 'चाहिए', 'मेरे', 'मेरा', 'और', 'या', 'भी', 'तो', 'यह', 'वह',
]);

const SUFFIXES = [
  'ांमध्ये', 'मध्ये', 'ामुळे', 'मुळे', 'ाच्या', 'च्या', 'ाची', 'ाचा', 'ाचे', 'ांना', 'ांचा', 'ांची', 'ांचे',
  'ावर', 'वर', 'ाला', 'ाने', 'ात', 'ाचा', 'ची', 'चा', 'चे', 'ला', 'ने', 'ना', 'ही', 'ें', 'ों', 'ाएं',
];

export function stem(token) {
  if (!/[\u0900-\u097F]/.test(token)) {
    return token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  }
  for (const s of SUFFIXES) {
    if (token.length - s.length >= 2 && token.endsWith(s)) return token.slice(0, -s.length);
  }
  return token;
}

export function tokenize(text = '', { stemTokens = true } = {}) {
  const lower = normalizeText(text).toLowerCase();
  return lower
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .map((w) => (stemTokens ? stem(w) : w))
    .filter((w) => w.length >= 2);
}

// ───────────────────────── 5. Language Detection ─────────────────────────

const MARATHI_MARKERS = [
  'आहे', 'नाही', 'काय', 'कसे', 'माझ्या', 'माझा', 'द्राक्ष', 'भुरी', 'करपा', 'काड्या', 'घ्यावा', 'करावे',
  'झाले', 'होऊन', 'आहेत', 'पाहिजे', 'किती', 'मला', 'तुम्ही', 'छाटणी', 'फवारणी', 'पाणी', 'कोणता', 'बागेत', 'वेली',
];
const HINDI_MARKERS = [
  'है', 'नहीं', 'क्या', 'कैसे', 'मेरे', 'मेरा', 'अंगूर', 'फफूंदी', 'धब्बे', 'बेल', 'करें', 'चाहिए', 'हैं',
  'कितना', 'में', 'छंटाई', 'छिड़काव', 'खाद', 'पानी', 'कौन',
];
const ROMAN_MARATHI = [
  'draksh', 'draksha', 'bhuri', 'karpa', 'kasa', 'kay', 'majhya', 'kasi', 'ahe', 'nahi', 'pani', 'chatani',
  'fawarni', 'khat', 'kiti', 'kadhi', 'zale', 'mala', 'aamchya', 'ghad', 'mani', 'sanga', 'upay', 'dyave',
];
const ROMAN_HINDI = [
  'angur', 'bimari', 'kya', 'kaise', 'mere', 'hai', 'nahin', 'kitna', 'chahiye', 'karein', 'dawa', 'paani', 'mera', 'kab',
];

const ROMAN_MARATHI_SET = new Set(ROMAN_MARATHI);
const ROMAN_HINDI_SET = new Set(ROMAN_HINDI);

export function detectLanguage(text = '') {
  const t = normalizeText(text).toLowerCase();
  if (!t) return { language: 'en', confidence: 0, script: 'none' };

  const dev = (t.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (t.match(/[a-z]/g) || []).length;
  const words = t.split(/[^\p{L}\p{M}]+/u).filter(Boolean);

  const score = (markers, useIncludes) =>
    markers.reduce((n, m) => n + (useIncludes ? (t.includes(m) ? 1 : 0) : (words.includes(m) ? 1 : 0)), 0);

  if (dev > latin) {
    const mr = score(MARATHI_MARKERS, true);
    const hi = score(HINDI_MARKERS, true);
    const mrBonus = (t.match(/ळ/g) || []).length > 0 ? 1 : 0;
    const total = mr + hi + mrBonus || 1;
    const language = mr + mrBonus >= hi ? 'mr' : 'hi';
    return {
      language,
      confidence: Math.min(1, ((language === 'mr' ? mr + mrBonus : hi) + 0.5) / (total + 0.5)),
      script: 'devanagari',
    };
  }

  const rMr = score(ROMAN_MARATHI, false);
  const rHi = score(ROMAN_HINDI, false);
  if (rMr + rHi > 0) {
    const language = rMr >= rHi ? 'mr' : 'hi';
    return { language, confidence: Math.max(rMr, rHi) / (rMr + rHi), script: 'romanized' };
  }
  return { language: 'en', confidence: 0.8, script: 'latin' };
}

// ───────────────────────── 6. Intent Classification ─────────────────────────

const INTENT_KEYWORDS = {
  disease_diagnosis: ['disease', 'sick', 'spots', 'white', 'fungus', 'भुरी', 'करपा', 'फफूंदी', 'धब्बे', 'रोग', 'डाऊनी', 'केवडा', 'mildew', 'blight', 'rot'],
  treatment: ['spray', 'medicine', 'fungicide', 'cure', 'औषध', 'फवारणी', 'दवा', 'छिड़काव', 'स्प्रे'],
  fertilizer: ['fertilizer', 'npk', 'urea', 'manure', 'खत', 'उर्वरक', 'खाद', 'डोस', 'युरिया'],
  pruning: ['prune', 'pruning', 'canopy', 'छाटणी', 'छंटाई', 'रिकट', 'पक्वता', 'फूट'],
  irrigation: ['water', 'drip', 'irrigation', 'पाणी', 'सिंचन', 'पानी', 'सिंचाई', 'ठिबक'],
  pest: ['thrips', 'mealybug', 'pest', 'insect', 'थ्रिप्स', 'मिलीबग', 'कीड', 'किडी', 'उडद्या', 'ढेकूण'],
  growth_regulator: ['ga3', 'cppu', 'gibberellic', 'फुगवण', 'साईज', 'डिपिंग', 'dipping', 'berry size', 'elongation', 'लांबी'],
};

export function classifyIntentByKeywords(text = '') {
  const t = normalizeText(text).toLowerCase();
  let best = { intent: 'general_query', hits: 0 };
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS)) {
    const hits = kws.reduce((n, kw) => n + (t.includes(kw) ? 1 : 0), 0);
    if (hits > best.hits) best = { intent, hits };
  }
  return best.intent;
}

const INTENT_SEEDS = {
  disease_diagnosis: [
    'my grape leaves have white powder spots', 'what disease is this on my vine leaves', 'leaves have yellow oily spots and white growth below',
    'पानांवर पांढरी भुरी दिसते आहे', 'पानांवर काळे डाग पडले आहेत हा कोणता रोग आहे', 'अंगूर के पत्तों पर सफेद फफूंदी लगी है', 'bhuri disease aali ahe pananvar',
  ],
  treatment: [
    'what should I spray for this disease', 'which fungicide to use and what dose', 'which medicine is best for mildew',
    'कोणती फवारणी घ्यावी', 'यावर कोणते औषध वापरावे', 'कौन सी दवा छिड़कनी चाहिए', 'konta spray gheu',
  ],
  fertilizer: [
    'what is the fertilizer schedule for grapes', 'how much urea or potash to give per acre', 'basal dose before pruning',
    'बेसल डोस किती आणि कोणता द्यावा', 'ठिबकद्वारे कोणते खत सोडावे', 'अंगूर में कौन सी खाद कितनी डालें', 'khat kiti dyave',
  ],
  pruning: [
    'when should I do foundation pruning', 'buds are not sprouting after pruning', 'cane maturity after recut',
    'खरड छाटणी कधी करावी', 'छाटणी होऊन बाग फुटत नाही', 'रिकट नंतर काडी पक्वता कशी मिळवावी', 'अंगूर की छंटाई कब करें',
  ],
  irrigation: [
    'how much water should I give through drip', 'irrigation schedule during berry development', 'when to stop watering before harvest',
    'ठिबक सिंचनाने किती पाणी द्यावे', 'वाफसा बघून पाणी कधी द्यावे', 'अंगूर में ड्रिप से कितना पानी दें', 'pani kiti dyave',
  ],
  pest: [
    'thrips are damaging new shoots', 'how to control mealybug on grape bunches', 'small insects eating buds after pruning',
    'थ्रिप्स वाढले आहेत कोणता स्प्रे घ्यावा', 'मिलीबग नियंत्रण कसे करावे', 'उडद्या कीड फुटीवर आली आहे', 'अंगूर में थ्रिप्स का इलाज',
  ],
  growth_regulator: [
    'how to use GA3 and CPPU for berry sizing', 'bunch elongation dose', 'berry size is small how to increase',
    'मण्यांची फुगवण वाढवण्यासाठी काय करावे', 'GA3 आणि CPPU चे प्रमाण किती', 'दाने का आकार बढ़ाने के लिए क्या करें', 'phugvan kashi vadhvavi',
  ],
  general_query: [
    'hello', 'tell me about grape farming', 'what services do you provide', 'नमस्कार', 'माहिती द्या', 'नमस्ते',
  ],
};

let centroids = null;
let centroidPromise = null;

function meanVector(vectors) {
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) { out[i] /= vectors.length; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

async function buildCentroids() {
  const built = {};
  for (const [intent, examples] of Object.entries(INTENT_SEEDS)) {
    const vecs = [];
    for (const ex of examples) {
      const v = await generateEmbedding(ex);
      if (!v) return null;
      vecs.push(v);
    }
    built[intent] = meanVector(vecs);
  }
  return built;
}

/**
 * Classify intent with the multilingual embedder (nearest centroid).
 * Returns { intent, confidence, method }.
 */
export async function classifyIntent(text = '', queryVector = null) {
  const keywordIntent = classifyIntentByKeywords(text);
  try {
    if (!centroids) {
      if (!centroidPromise) centroidPromise = buildCentroids().then((c) => { centroids = c; centroidPromise = null; return c; });
      await centroidPromise;
    }
    if (!centroids) return { intent: keywordIntent, confidence: 0.5, method: 'keyword' };

    const vec = queryVector || (await generateEmbedding(normalizeText(text)));
    if (!vec) return { intent: keywordIntent, confidence: 0.5, method: 'keyword' };

    const scored = Object.entries(centroids).map(([intent, c]) => {
      let dot = 0;
      for (let i = 0; i < vec.length; i++) dot += vec[i] * c[i];
      return { intent, score: dot };
    }).sort((a, b) => b.score - a.score);

    const [top, second] = scored;
    if (top.score < 0.30 || (top.score - second.score < 0.02 && keywordIntent !== 'general_query')) {
      return { intent: keywordIntent, confidence: 0.5, method: 'keyword-fallback' };
    }
    return { intent: top.intent, confidence: Math.min(1, Math.max(0, top.score)), method: 'embedding' };
  } catch (err) {
    console.warn('⚠️ Intent classifier fell back to keywords:', err.message);
    return { intent: keywordIntent, confidence: 0.5, method: 'keyword' };
  }
}

export const _internals = { STOP_WORDS, GLOSSARY, DIRECT_TYPO_MAP, CANONICAL_LATIN_VOCAB };
