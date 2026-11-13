import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  scrubPii,
  spellCorrectToken,
  correctGrammarAndSpelling,
  expandQuery,
  detectLanguage,
  tokenize,
  classifyIntentByKeywords,
} from '../services/nlp.js';
import { isSupportedLanguage, getEnabledLanguages, SUPPORTED_LANGUAGES } from '../config/languages.js';

test('Extensible regional language registry (PDF §2)', () => {
  assert.equal(isSupportedLanguage('en'), true);
  assert.equal(isSupportedLanguage('mr'), true);
  assert.equal(isSupportedLanguage('hi'), true);
  assert.equal(isSupportedLanguage('fr'), false);
  // Future regional hooks exist in registry
  assert.ok(SUPPORTED_LANGUAGES.kn);
  assert.ok(SUPPORTED_LANGUAGES.gu);
  assert.ok(SUPPORTED_LANGUAGES.te);
  assert.equal(getEnabledLanguages().length, 3);
});

test('Token-level spell & typo correction (English, Hinglish, Marathi, Hindi)', () => {
  assert.equal(spellCorrectToken('powdry'), 'powdery');
  assert.equal(spellCorrectToken('mildw'), 'mildew');
  assert.equal(spellCorrectToken('gibrelik'), 'gibberellic');
  assert.equal(spellCorrectToken('fungiside'), 'fungicide');
  assert.equal(spellCorrectToken('hexaconazol'), 'hexaconazole');
  assert.equal(spellCorrectToken('spraaaay'), 'spray');
  assert.equal(spellCorrectToken('कोनती'), 'कोणती');
  assert.equal(spellCorrectToken('फवारनी'), 'फवारणी');
  // Phonetic / edit-distance matches not hardcoded in DIRECT_TYPO_MAP
  assert.equal(spellCorrectToken('myclobutanl'), 'myclobutanil');
  assert.equal(spellCorrectToken('photosynthess'), 'photosynthess'); // Out-of-domain word untouched
});

test('Real-time grammatical error & typo normalization (English)', () => {
  const res = correctGrammarAndSpelling('my grape leaf have white spot wht spary');
  assert.equal(res.hasChanges, true);
  assert.equal(res.corrected, 'My grape leaves have white spots what should I spray?');
  assert.ok(res.corrections.length >= 2);
});

test('Chemical dosage unit normalization & chemical typo correction', () => {
  const res = correctGrammarAndSpelling('can i use hexaconazol 2ml/liter and 50ppm gibrelik asid');
  assert.equal(res.hasChanges, true);
  assert.match(res.corrected, /hexaconazole/i);
  assert.match(res.corrected, /2 ml\/L/);
  assert.match(res.corrected, /50 ppm/);
  assert.match(res.corrected, /gibberellic acid/i);
});

test('Marathi & Hindi Devanagari spelling + grammar normalization', () => {
  const mr = correctGrammarAndSpelling('पानावर पांढरा भुरी आली आहे कोनती फवारनी घ्याव');
  assert.equal(mr.hasChanges, true);
  assert.equal(mr.corrected, 'पानावर पांढरी भुरी आली आहे कोणती फवारणी घ्यावी?');
  assert.equal(mr.detectedLanguage.language, 'mr');
  assert.equal(mr.detectedLanguage.script, 'devanagari');

  const hi = correctGrammarAndSpelling('अंगूर के पत्ते पर सफेद धब्बे है कोनसा दवा डाले');
  assert.equal(hi.hasChanges, true);
  assert.equal(hi.corrected, 'अंगूर के पत्तों पर सफेद धब्बे हैं कौन सी दवा डाले?');
  assert.equal(hi.detectedLanguage.language, 'hi');
});

test('Romanized Marathi / Hinglish glossary expansion & language detection', () => {
  const res = correctGrammarAndSpelling('drakshavar bhuri rog ahe fawrni kiti dyavi');
  assert.equal(res.detectedLanguage.language, 'mr');
  assert.match(res.expandedQuery, /भुरी/);
  assert.match(res.expandedQuery, /powdery mildew/);
  assert.match(res.expandedQuery, /फवारणी/);
});

test('PII scrubbing redacts phone numbers, emails, and 12-digit IDs (PDF §10)', () => {
  const dirty = 'My name is Ramesh call me on +91 9876543210 or email farmer@test.com or aadhaar 1234 5678 9012';
  const clean = scrubPii(dirty);
  assert.ok(!clean.includes('9876543210'));
  assert.ok(!clean.includes('farmer@test.com'));
  assert.ok(!clean.includes('1234 5678 9012'));
  assert.match(clean, /\[PHONE_REDACTED\]/);
  assert.match(clean, /\[EMAIL_REDACTED\]/);
  assert.match(clean, /\[ID_REDACTED\]/);
});

test('Tokenization & intent keyword fallback across languages', () => {
  const tokens = tokenize('माझ्या द्राक्ष बागेवर भुरी रोगासाठी फवारणी सांगा');
  assert.ok(tokens.length >= 3);
  assert.equal(classifyIntentByKeywords('पानांवर पांढरी भुरी दिसते आहे'), 'disease_diagnosis');
  assert.equal(classifyIntentByKeywords('GA3 आणि CPPU चे प्रमाण किती'), 'growth_regulator');
});
