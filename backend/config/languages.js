/**
 * languages.js — Extensible Regional Language Registry (PDF §2)
 * ═════════════════════════════════════════════════════════════
 * Centralizes all language metadata so adding new Indian regional
 * languages (e.g., Kannada, Gujarati, Telugu) requires only adding
 * an entry here rather than modifying scattered route checks.
 */

export const SUPPORTED_LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    ttsLang: 'en-IN',
    script: 'latin',
    enabled: true,
  },
  mr: {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    ttsLang: 'mr-IN',
    script: 'devanagari',
    enabled: true,
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिंदी',
    ttsLang: 'hi-IN',
    script: 'devanagari',
    enabled: true,
  },
  // Ready for future regional expansion (PDF §2): flip enabled: true when UI translations are added
  kn: {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    ttsLang: 'kn-IN',
    script: 'kannada',
    enabled: false,
  },
  gu: {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    ttsLang: 'gu-IN',
    script: 'gujarati',
    enabled: false,
  },
  te: {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    ttsLang: 'te-IN',
    script: 'telugu',
    enabled: false,
  },
};

export const SUPPORTED_LANGUAGE_CODES = Object.values(SUPPORTED_LANGUAGES)
  .filter((l) => l.enabled)
  .map((l) => l.code);

export function isSupportedLanguage(code) {
  return Boolean(code && SUPPORTED_LANGUAGES[code]?.enabled);
}

export function getLanguageName(code) {
  return SUPPORTED_LANGUAGES[code]?.name || 'English';
}

export function getEnabledLanguages() {
  return Object.values(SUPPORTED_LANGUAGES).filter((l) => l.enabled);
}
