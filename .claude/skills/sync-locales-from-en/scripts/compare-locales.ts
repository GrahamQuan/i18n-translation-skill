#!/usr/bin/env tsx
/**
 * Compare en/ with other locale directories to find missing keys
 * Output: JSON report of missing keys per locale per file
 *
 * Usage: pnpm i18n:compare
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import { REFERENCE_DIR, flattenObject, getLocales, getMessageFiles, MESSAGES_DIR_EXPORT, type MissingReport } from './helpers';

const MESSAGES_DIR = MESSAGES_DIR_EXPORT;
const OUTPUT_DIR = REFERENCE_DIR;

function getKeysFromFile(filePath: string): Set<string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(content);
  const flattened = flattenObject(json);
  return new Set(Object.keys(flattened));
}

async function main() {
  console.log('🔍 Starting locale comparison...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const messageFiles = getMessageFiles();
  const locales = getLocales();
  const reports: MissingReport[] = [];
  let totalKeys = 0;

  messageFiles.forEach((file) => {
    const enPath = path.join(MESSAGES_DIR, 'en', file);
    const enKeys = getKeysFromFile(enPath);
    totalKeys += enKeys.size;

    locales.forEach((locale) => {
      const localePath = path.join(MESSAGES_DIR, locale, file);
      let missingKeys: string[];

      if (!fs.existsSync(localePath)) {
        missingKeys = Array.from(enKeys);
      } else {
        const localeKeys = getKeysFromFile(localePath);
        missingKeys = Array.from(enKeys).filter((key) => !localeKeys.has(key));
      }

      if (missingKeys.length > 0) {
        reports.push({ locale, file, missingKeys, missingCount: missingKeys.length });
        console.log(`${locale}/${file}: ${missingKeys.length} missing keys`);
      }
    });
  });

  const reportPath = path.join(OUTPUT_DIR, 'missing-keys-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
  console.log(`\n✅ Report saved to: ${reportPath}`);

  const totalMissing = reports.reduce((sum, r) => sum + r.missingCount, 0);
  console.log('\n📊 Summary:');
  console.log(`   Files: ${messageFiles.join(', ')}`);
  console.log(`   Locales: ${locales.length}`);
  console.log(`   Total en keys: ${totalKeys}`);
  console.log(`   Total missing: ${totalMissing}`);

  if (totalMissing === 0) {
    console.log('\n🎉 All locales are in sync!');
  }
}

main().catch(console.error);
