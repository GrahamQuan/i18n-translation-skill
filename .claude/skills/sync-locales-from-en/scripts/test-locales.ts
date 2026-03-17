#!/usr/bin/env tsx
/**
 * Test locale files against en/ directory
 * Validates that all locale files have the exact same keys and nested structure
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import { getLocales, getMessageFiles, type NestedObject } from './helpers';

const MESSAGES_DIR = path.join(process.cwd(), 'messages');

function getStructure(obj: NestedObject, prefix = ''): Map<string, 'branch' | 'leaf'> {
  const result = new Map<string, 'branch' | 'leaf'>();

  Object.entries(obj).forEach(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result.set(fullKey, 'branch');
      const nested = getStructure(value as NestedObject, fullKey);
      nested.forEach((v, k) => result.set(k, v));
    } else {
      result.set(fullKey, 'leaf');
    }
  });

  return result;
}

interface FileTestResult {
  locale: string;
  file: string;
  pass: boolean;
  missingKeys: string[];
  extraKeys: string[];
  typeMismatches: string[];
}

function testLocaleFile(
  locale: string,
  file: string,
  enStructure: Map<string, 'branch' | 'leaf'>,
): FileTestResult {
  const localePath = path.join(MESSAGES_DIR, locale, file);

  if (!fs.existsSync(localePath)) {
    return { locale, file, pass: false, missingKeys: ['FILE NOT FOUND'], extraKeys: [], typeMismatches: [] };
  }

  let localeJson: NestedObject;
  try {
    localeJson = JSON.parse(fs.readFileSync(localePath, 'utf-8')) as NestedObject;
  } catch {
    return { locale, file, pass: false, missingKeys: ['INVALID JSON'], extraKeys: [], typeMismatches: [] };
  }

  const localeStructure = getStructure(localeJson);

  const missingKeys: string[] = [];
  const typeMismatches: string[] = [];

  Array.from(enStructure.entries()).forEach(([key, enType]) => {
    const localeType = localeStructure.get(key);
    if (!localeType) {
      missingKeys.push(key);
    } else if (localeType !== enType) {
      typeMismatches.push(`${key} (en: ${enType}, ${locale}: ${localeType})`);
    }
  });

  const extraKeys: string[] = [];
  Array.from(localeStructure.keys()).forEach((key) => {
    if (!enStructure.has(key)) {
      extraKeys.push(key);
    }
  });

  return {
    locale,
    file,
    pass: missingKeys.length === 0 && extraKeys.length === 0 && typeMismatches.length === 0,
    missingKeys,
    extraKeys,
    typeMismatches,
  };
}

async function main() {
  console.log('🧪 Testing locale files against en/...\n');

  const messageFiles = getMessageFiles();
  const locales = getLocales();
  let allPassed = true;
  let totalResults = 0;
  let passCount = 0;

  messageFiles.forEach((file) => {
    const enPath = path.join(MESSAGES_DIR, 'en', file);
    const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8')) as NestedObject;
    const enStructure = getStructure(enJson);
    const leafCount = Array.from(enStructure.values()).filter((v) => v === 'leaf').length;
    console.log(`📚 en/${file}: ${leafCount} leaf keys`);

    locales.forEach((locale) => {
      totalResults++;
      const result = testLocaleFile(locale, file, enStructure);

      if (result.pass) {
        passCount++;
        console.log(`  ✅ ${locale}/${file}: PASS`);
      } else {
        allPassed = false;
        console.log(`  ❌ ${locale}/${file}: FAIL`);

        if (result.missingKeys.length > 0) {
          console.log(`     Missing (${result.missingKeys.length}):`);
          result.missingKeys.slice(0, 5).forEach((k) => console.log(`       - ${k}`));
          if (result.missingKeys.length > 5) console.log(`       ... and ${result.missingKeys.length - 5} more`);
        }
        if (result.extraKeys.length > 0) {
          console.log(`     Extra (${result.extraKeys.length}):`);
          result.extraKeys.slice(0, 5).forEach((k) => console.log(`       - ${k}`));
          if (result.extraKeys.length > 5) console.log(`       ... and ${result.extraKeys.length - 5} more`);
        }
        if (result.typeMismatches.length > 0) {
          console.log(`     Mismatches (${result.typeMismatches.length}):`);
          result.typeMismatches.slice(0, 5).forEach((k) => console.log(`       - ${k}`));
        }
      }
    });
    console.log('');
  });

  console.log(`📊 Results: ${passCount}/${totalResults} passed`);

  if (allPassed) {
    console.log('\n🎉 All locale files match en/ structure!');
  } else {
    console.log('\n💥 Some locale files have issues. Run /sync-locales-from-en to fix.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
