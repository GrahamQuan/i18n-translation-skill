/**
 * Helper utilities for i18n translation workflow
 * Used by compare-locales.ts, merge-translations.ts, and Claude Code during translation
 */

import * as fs from 'fs';
import * as path from 'path';

export interface NestedObject {
  [key: string]: string | NestedObject;
}

export interface MissingReport {
  locale: string;
  file: string;
  missingKeys: string[];
  missingCount: number;
}

const MESSAGES_DIR = path.join(process.cwd(), 'messages');

// Temp directory structure for translation workflow
const SKILL_DIR = path.join(process.cwd(), '.claude', 'skills', 'sync-locales-from-en');
const TODAY = new Date().toISOString().split('T')[0];
const TEMP_ROOT = path.join(SKILL_DIR, 'temp', TODAY);
export const REFERENCE_DIR = path.join(TEMP_ROOT, 'reference');
export const INTERMEDIATE_DIR = path.join(TEMP_ROOT, 'intermediate');
export const FINAL_DIR = path.join(TEMP_ROOT, 'final');
export const MESSAGES_DIR_EXPORT = MESSAGES_DIR;

/**
 * Known language names for translation prompts.
 * If a locale isn't here, falls back to the locale code itself.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  cn: 'Simplified Chinese',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  th: 'Thai',
  tw: 'Traditional Chinese',
  vi: 'Vietnamese',
};

/**
 * Dynamically get locale codes from messages/ directory (excludes en)
 */
export function getLocales(): string[] {
  return fs
    .readdirSync(MESSAGES_DIR)
    .filter((f) => f !== 'en' && fs.statSync(path.join(MESSAGES_DIR, f)).isDirectory())
    .sort();
}

/**
 * Get message file names from en/ directory (e.g. ['main.json', 'ui.json', 'model.json'])
 */
export function getMessageFiles(): string[] {
  const enDir = path.join(MESSAGES_DIR, 'en');
  return fs
    .readdirSync(enDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

/**
 * Get human-readable language name for a locale code.
 * Falls back to the locale code if not in the known map.
 */
export function getLanguageName(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? locale;
}

/**
 * Flatten nested object to dot notation paths
 * e.g., { a: { b: 'value' } } => { 'a.b': 'value' }
 */
export function flattenObject(obj: NestedObject, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  Object.entries(obj).forEach(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as NestedObject, newKey));
    } else {
      result[newKey] = String(value);
    }
  });

  return result;
}

/**
 * Unflatten dot notation to nested object
 * e.g., { 'a.b': 'value' } => { a: { b: 'value' } }
 */
export function unflattenObject(flat: Record<string, string>): NestedObject {
  const result: NestedObject = {};

  Object.entries(flat).forEach(([key, value]) => {
    const parts = key.split('.');
    let current: any = result;

    parts.slice(0, -1).forEach((part) => {
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    });

    current[parts[parts.length - 1]] = value;
  });

  return result;
}

/**
 * Sort keys within a level: title, description first, then numbered keys (1,2,3...), then rest preserving original order
 */
function sortKeys(keys: string[]): string[] {
  const priority: Record<string, number> = { title: 0, description: 1 };

  return [...keys].sort((a, b) => {
    const pa = priority[a] ?? (isFinite(Number(a)) ? 2 : 3);
    const pb = priority[b] ?? (isFinite(Number(b)) ? 2 : 3);
    if (pa !== pb) return pa - pb;
    if (pa === 2) return Number(a) - Number(b);
    return 0;
  });
}

/**
 * Recursively sort keys in a nested object: title/description first, then numbered, then rest
 * Note: JS objects enumerate integer keys first, so use stringifySorted() for correct JSON output.
 */
export function sortNestedObject(obj: NestedObject): NestedObject {
  const sorted: NestedObject = {};
  const orderedKeys = sortKeys(Object.keys(obj));

  orderedKeys.forEach((key) => {
    const value = obj[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sorted[key] = sortNestedObject(value as NestedObject);
    } else {
      sorted[key] = value;
    }
  });

  return sorted;
}

/**
 * Stringify a nested object with custom key ordering at every level.
 * JS objects always enumerate integer keys before string keys, so JSON.stringify
 * cannot produce the desired order. This function handles it manually.
 */
export function stringifySorted(obj: NestedObject, indent = 2, depth = 0): string {
  const pad = ' '.repeat(indent * (depth + 1));
  const closePad = ' '.repeat(indent * depth);
  const orderedKeys = sortKeys(Object.keys(obj));

  const entries = orderedKeys.map((key) => {
    const value = obj[key];
    const jsonKey = JSON.stringify(key);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return `${pad}${jsonKey}: ${stringifySorted(value as NestedObject, indent, depth + 1)}`;
    }
    return `${pad}${jsonKey}: ${JSON.stringify(value)}`;
  });

  return `{\n${entries.join(',\n')}\n${closePad}}`;
}

/**
 * Get key order from a nested object, sorted: title/description first, then numbered, then rest
 */
export function getKeyOrder(obj: NestedObject, prefix = ''): string[] {
  const keys: string[] = [];
  const sorted = sortKeys(Object.keys(obj));

  sorted.forEach((key) => {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getKeyOrder(value as NestedObject, fullKey));
    } else {
      keys.push(fullKey);
    }
  });

  return keys;
}

/**
 * Unflatten with specific key order (preserves en.json order)
 */
export function unflattenWithOrder(flat: Record<string, string>, keyOrder: string[]): NestedObject {
  const result: NestedObject = {};

  keyOrder.forEach((key) => {
    if (!(key in flat)) return;

    const parts = key.split('.');
    let current: any = result;

    parts.slice(0, -1).forEach((part) => {
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    });

    current[parts[parts.length - 1]] = flat[key];
  });

  return result;
}

/**
 * Format key-value pairs for translation prompt
 */
export function formatForTranslation(texts: Record<string, string>): string {
  return Object.entries(texts)
    .map(([key, value]) => `${key}::${value}`)
    .join('\n');
}

/**
 * Parse translation response back to key-value pairs
 */
export function parseTranslationResponse(response: string): Record<string, string> {
  const translated: Record<string, string> = {};
  const lines = response.trim().split('\n');

  lines.forEach((line) => {
    const match = line.match(/^(.+?)::(.+)$/);
    if (match) {
      const [, key, translatedText] = match;
      translated[key.trim()] = translatedText.trim();
    }
  });

  return translated;
}

/**
 * Split keys into batches for translation
 */
export function batchKeys(keys: string[], batchSize: number): string[][] {
  return Array.from({ length: Math.ceil(keys.length / batchSize) }, (_, i) =>
    keys.slice(i * batchSize, (i + 1) * batchSize),
  );
}
