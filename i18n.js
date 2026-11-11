const fs = require('fs');
const path = require('path');

const SUPPORTED = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi', 'nl', 'pl'];
const RTL = new Set(['ar']);
const LOCALE_DIR = path.join(__dirname, 'locales');

// "tr-TR" / "tr_TR" / "tr" -> "tr". Anything unsupported falls back to English.
function resolveLang(locale) {
  const base = String(locale || 'en').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(base) ? base : 'en';
}

function readLocale(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, lang + '.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

// English is always the base, so a missing key in another language falls back to it.
function loadStrings(lang) {
  const en = readLocale('en');
  return lang === 'en' ? en : { ...en, ...readLocale(lang) };
}

module.exports = {
  SUPPORTED,
  resolveLang,
  loadStrings,
  isRtl: (lang) => RTL.has(lang)
};
