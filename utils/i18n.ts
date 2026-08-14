import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/translation.json';
import es from '../locales/es/translation.json';

const fallbackLng = 'en';

// The registered locales. i18next renders fallbackLng for any other language
// code, so constraining the initial language here keeps a device running,
// say, French from silently rendering English from the first frame.
export const SUPPORTED_LOCALES = ['en', 'es'];

const deviceLocale = Localization.getLocales()[0]?.languageCode || fallbackLng;
const defaultLocale = SUPPORTED_LOCALES.includes(deviceLocale) ? deviceLocale : fallbackLng;

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },

    lng: defaultLocale, // Use the language code of the first locale
    fallbackLng, // Fallback to English if no translations are found
    interpolation: {
      escapeValue: false, // React already handles XSS
    },
  });

export default i18n;
