import fs from 'fs';
import path from 'path';

// E1: the app ships exactly two locales with identical key coverage. This
// test is the only thing that keeps en and es in step, and it also protects
// the reduction itself — locales/ must never grow a third directory.

const LOCALES_DIR = path.join(__dirname);

interface LocaleData {
  [key: string]: string | LocaleData;
}

const flatten = (data: LocaleData, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const flatKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      Object.assign(out, flatten(value as LocaleData, flatKey));
    } else {
      out[flatKey] = value;
    }
  }
  return out;
};

const PLURAL_SUFFIX_RE = /_(one|other|few|many|zero|two)$/;

const pluralForms = (keys: string[]): Record<string, Set<string>> => {
  const forms: Record<string, Set<string>> = {};
  for (const key of keys) {
    const base = key.replace(PLURAL_SUFFIX_RE, '');
    const form = key === base ? '' : key.slice(base.length);
    (forms[base] ??= new Set()).add(form);
  }
  return forms;
};

const loadFlat = (lang: string): Record<string, string> =>
  flatten(
    JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, lang, 'translation.json'), 'utf8'),
    ) as LocaleData,
  );

describe('locale parity', () => {
  test('locales/ contains exactly en and es', () => {
    const dirs = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual(['en', 'es']);
  });

  test('en and es have identical flattened key sets', () => {
    const enKeys = Object.keys(loadFlat('en'));
    const esKeys = Object.keys(loadFlat('es'));
    expect(enKeys.filter((key) => !esKeys.includes(key))).toEqual([]);
    expect(esKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  test('every key has the same plural forms in both locales', () => {
    const enForms = pluralForms(Object.keys(loadFlat('en')));
    const esForms = pluralForms(Object.keys(loadFlat('es')));
    const bases = new Set([...Object.keys(enForms), ...Object.keys(esForms)]);
    for (const base of bases) {
      expect([...(enForms[base] ?? [])].sort()).toEqual(
        [...(esForms[base] ?? [])].sort(),
      );
    }
  });
});
