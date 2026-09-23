/**
 * languageDetector.js — NLP Language & Intent Classification
 * ══════════════════════════════════════════════════════════
 * 
 * Analyzes raw farmer text to detect the spoken language and
 * classify the high-level intent.
 * 
 * Supports:
 * - English (en)
 * - Marathi (mr) — Devnagari script + Romanized (e.g., "draksh")
 * - Hindi (hi) — Devnagari script + Romanized (e.g., "angur")
 */

export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return { language: 'en', intent: 'unknown' };

  const lowerText = text.toLowerCase();
  
  // 1. Detect Script (Devnagari)
  const devnagariPattern = /[\u0900-\u097F]/;
  const hasDevnagari = devnagariPattern.test(lowerText);
  
  let language = 'en';

  if (hasDevnagari) {
    // Distinguish between Hindi and Marathi based on common stop words/suffixes
    const marathiMarkers = ['आहे', 'नाही', 'काय', 'कसे', 'माझ्या', 'द्राक्ष', 'भुरी', 'करपा', 'काड्या'];
    const hindiMarkers = ['है', 'नहीं', 'क्या', 'कैसे', 'मेरे', 'अंगूर', 'फफूंदी', 'धब्बे', 'बेल'];
    
    let mrScore = 0;
    let hiScore = 0;
    
    marathiMarkers.forEach(m => { if (lowerText.includes(m)) mrScore++; });
    hindiMarkers.forEach(h => { if (lowerText.includes(h)) hiScore++; });
    
    language = mrScore >= hiScore ? 'mr' : 'hi';
  } else {
    // Check for Romanized regional languages (very common among farmers)
    const romanizedMarathi = ['draksh', 'bhuri', 'karpa', 'kasa', 'kay', 'majhya'];
    const romanizedHindi = ['angur', 'bimari', 'kya', 'kaise', 'mere'];
    
    let rMrScore = 0;
    let rHiScore = 0;
    
    romanizedMarathi.forEach(m => { if (lowerText.includes(m)) rMrScore++; });
    romanizedHindi.forEach(h => { if (lowerText.includes(h)) rHiScore++; });
    
    if (rMrScore > 0 && rMrScore >= rHiScore) language = 'mr';
    else if (rHiScore > 0) language = 'hi';
  }

  // 2. Classify Intent
  let intent = 'general_query';
  
  const intentKeywords = {
    disease_diagnosis: ['disease', 'sick', 'spots', 'white', 'yellow', 'fungus', 'भुरी', 'करपा', 'फफूंदी', 'धब्बे', 'रोग'],
    treatment: ['spray', 'medicine', 'fungicide', 'cure', 'औषध', 'फवारणी', 'दवा', 'छिड़काव'],
    fertilizer: ['fertilizer', 'npk', 'urea', 'manure', 'खत', 'उर्वरक', 'खाद'],
    pruning: ['prune', 'cut', 'canopy', 'छाटणी', 'छंटाई'],
    irrigation: ['water', 'drip', 'irrigation', 'पाणी', 'सिंचन', 'पानी', 'सिंचाई']
  };

  for (const [key, keywords] of Object.entries(intentKeywords)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      intent = key;
      break; // Pick first matching intent
    }
  }

  return { language, intent };
}
