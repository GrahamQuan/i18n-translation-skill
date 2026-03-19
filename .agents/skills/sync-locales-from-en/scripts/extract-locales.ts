#!/usr/bin/env tsx
/**
 * Extract missing locale keys into reference/ and draft/ directories.
 * - reference/{file}.json: English values for all missing keys (union across locales)
 * - draft/{locale}.json: Flat JSON object with {file}::{dotpath} keys and English values
 *
 * Usage: pnpm i18n:extract
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import {
  REFERENCE_DIR,
  flattenObject,
  getKeyOrder,
  DRAFT_DIR,
  MESSAGES_DIR_EXPORT,
  unflattenWithOrder,
  BATCH_SIZE,
  getChunkFilename,
  type MissingReport,
  type NestedObject,
} from './helpers';

const MESSAGES_DIR = MESSAGES_DIR_EXPORT;
const REPORT_PATH = path.join(REFERENCE_DIR, 'missing-keys-report.json');

function readMissingReport(filePath: string): MissingReport[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content) as MissingReport[];
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid missing-keys-report.json format: expected an array');
  }
  return parsed;
}

async function main() {
  console.log('📦 Extracting locale templates from en/...\n');

  if (!fs.existsSync(REFERENCE_DIR)) {
    console.error(`❌ Error: Reference directory not found: ${REFERENCE_DIR}`);
    console.error('   Please run pnpm i18n:compare first');
    process.exit(1);
  }

  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`❌ Error: Missing report not found: ${REPORT_PATH}`);
    console.error('   Please run pnpm i18n:compare first');
    process.exit(1);
  }

  const reports = readMissingReport(REPORT_PATH);
  const withMissing = reports.filter((r) => r.missingCount > 0);

  if (withMissing.length === 0) {
    console.log('🎉 No missing keys found. Nothing to extract.');
    return;
  }

  // Group reports by file to create base files
  const fileGroups = new Map<string, MissingReport[]>();
  withMissing.forEach((report) => {
    if (!fileGroups.has(report.file)) {
      fileGroups.set(report.file, []);
    }
    fileGroups.get(report.file)!.push(report);
  });

  // Cache en file data per file
  const enCache = new Map<string, { flat: Record<string, string>; keyOrder: string[] }>();

  // Step 1: Create reference/{file}.json with union of all missing keys
  console.log('📝 Creating reference files...\n');
  fileGroups.forEach((fileReports, file) => {
    const enPath = path.join(MESSAGES_DIR, 'en', file);
    const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8')) as NestedObject;
    const enFlat = flattenObject(enJson);
    const keyOrder = getKeyOrder(enJson);
    enCache.set(file, { flat: enFlat, keyOrder });

    // Union of all missing keys for this file
    const allMissingKeys = new Set<string>();
    fileReports.forEach((r) => r.missingKeys.forEach((k) => allMissingKeys.add(k)));

    const baseFlat: Record<string, string> = {};
    allMissingKeys.forEach((key) => {
      if (enFlat[key] !== undefined) {
        baseFlat[key] = enFlat[key];
      }
    });

    const baseOrdered = unflattenWithOrder(baseFlat, keyOrder) as NestedObject;
    const basePath = path.join(REFERENCE_DIR, file);
    fs.writeFileSync(basePath, `${JSON.stringify(baseOrdered, null, 2)}\n`);
    console.log(`✅ reference/${file}: ${Object.keys(baseFlat).length} keys`);
  });

  // Step 2: Create draft/{locale}.json — flat JSON with {file}::{dotpath} keys
  console.log('\n📝 Creating draft flat files...\n');

  if (!fs.existsSync(DRAFT_DIR)) {
    fs.mkdirSync(DRAFT_DIR, { recursive: true });
  }

  // Group reports by locale
  const localeGroups = new Map<string, MissingReport[]>();
  withMissing.forEach((report) => {
    if (!localeGroups.has(report.locale)) {
      localeGroups.set(report.locale, []);
    }
    localeGroups.get(report.locale)!.push(report);
  });

  localeGroups.forEach((localeReports, locale) => {
    const flat: Record<string, string> = {};

    localeReports.forEach((report) => {
      const cached = enCache.get(report.file);
      if (!cached) return;

      report.missingKeys.forEach((key) => {
        const englishValue = cached.flat[key];
        if (englishValue !== undefined) {
          flat[`${report.file}::${key}`] = englishValue;
        }
      });
    });

    // Split into chunks of BATCH_SIZE
    const entries = Object.entries(flat);
    const chunkCount = Math.ceil(entries.length / BATCH_SIZE);

    for (let i = 0; i < chunkCount; i++) {
      const chunkEntries = entries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      const chunkObj = Object.fromEntries(chunkEntries);
      const chunkFile = getChunkFilename(locale, i);
      const outputPath = path.join(DRAFT_DIR, chunkFile);
      fs.writeFileSync(outputPath, `${JSON.stringify(chunkObj, null, 2)}\n`);
      console.log(`✅ draft/${chunkFile}: ${chunkEntries.length} keys`);
    }
  });

  const localeCount = localeGroups.size;
  console.log('\n✅ Extraction complete!');
  console.log(`   Reference directory: ${REFERENCE_DIR}`);
  console.log(`   Draft directory: ${DRAFT_DIR}`);
  console.log(`   Locales with missing keys: ${localeCount}`);
}

main().catch((error) => {
  console.error('\n❌ Extraction failed:', error);
  process.exit(1);
});
