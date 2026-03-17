#!/usr/bin/env tsx
/**
 * Merge translated temp files back to messages/ directory
 * Preserves key order from en/{file}.json
 *
 * Usage: pnpm i18n:merge
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import { flattenObject, getKeyOrder, getLocales, getMessageFiles, FINAL_DIR, MESSAGES_DIR_EXPORT, stringifySorted, unflattenWithOrder, type NestedObject } from './helpers';

const MESSAGES_DIR = MESSAGES_DIR_EXPORT;

function mergeLocaleFile(locale: string, file: string, keyOrder: string[]) {
  const tempPath = path.join(FINAL_DIR, locale, file);
  const targetPath = path.join(MESSAGES_DIR, locale, file);

  if (!fs.existsSync(tempPath)) {
    return;
  }

  const tempFlat = flattenObject(JSON.parse(fs.readFileSync(tempPath, 'utf-8')) as NestedObject);

  let existingFlat: Record<string, string> = {};
  if (fs.existsSync(targetPath)) {
    existingFlat = flattenObject(JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as NestedObject);
  }

  const mergedFlat = { ...existingFlat, ...tempFlat };
  const ordered = unflattenWithOrder(mergedFlat, keyOrder);

  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, `${stringifySorted(ordered)}\n`);
  console.log(`✅ ${locale}/${file}: Merged ${Object.keys(tempFlat).length} keys`);
}

async function main() {
  console.log('🔄 Starting merge process...\n');

  if (!fs.existsSync(FINAL_DIR)) {
    console.error(`❌ Error: Final directory not found: ${FINAL_DIR}`);
    console.error('   Please run translation and unflatten steps first');
    process.exit(1);
  }

  const messageFiles = getMessageFiles();
  const locales = getLocales();

  // Cache key orders per file
  const keyOrders = new Map<string, string[]>();
  messageFiles.forEach((file) => {
    const enPath = path.join(MESSAGES_DIR, 'en', file);
    const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8')) as NestedObject;
    keyOrders.set(file, getKeyOrder(enJson));
  });

  console.log(`📚 Files: ${messageFiles.join(', ')}\n`);

  locales.forEach((locale) => {
    messageFiles.forEach((file) => {
      mergeLocaleFile(locale, file, keyOrders.get(file)!);
    });
  });

  console.log('\n✅ Merge complete!');
}

main().catch(console.error);
