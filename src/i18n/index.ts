import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import sk from './locales/sk.json'

const SUPPORTED_LANGUAGES = ['en', 'sk'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
}

// Default is whatever the browser reports, with no hardcoded fallback
// language — an explicit user choice (via the language switcher) is
// remembered in localStorage and takes priority on future visits.
function detectLanguage(): SupportedLanguage {
  const saved = localStorage.getItem('language')
  if (saved === 'en' || saved === 'sk') return saved

  const browserLang = navigator.language.split('-')[0]
  return browserLang === 'sk' ? 'sk' : 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sk: { translation: sk }
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

export function setLanguage(lang: SupportedLanguage) {
  localStorage.setItem('language', lang)
  i18n.changeLanguage(lang)
}

export default i18n
