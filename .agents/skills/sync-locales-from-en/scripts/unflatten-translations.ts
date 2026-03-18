#!/usr/bin/env tsx
/**
 * Unflatten translated files into final nested JSON.
 * Reads translation/{locale}.json (flat JSON with {file}::{dotpath} keys),
 * splits by source file, unflattens, and writes to final/{locale}/{file}.json.
 *
 * Usage: pnpm i18n:unflatten
 */

/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';

import {
  FINAL_DIR,
  getKeyOrder,
  TRANSLATION_DIR,
  MESSAGES_DIR_EXPORT,
  unflattenWithOrder,
  type NestedObject,
} from './helpers';

const MESSAGES_DIR = MESSAGES_DIR_EXPORT;

function parseIntermediateFile(filePath: string): Map<string, Record<string, string>> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const flat = JSON.parse(content) as Record<string, string>;
  const grouped = new Map<string, Record<string, string>>();

  Object.entries(flat).forEach(([compositeKey, value]) => {
    // Key format: {file}::{dotpath}
    const sep = compositeKey.indexOf('::');
    if (sep === -1) return;

    const file = compositeKey.substring(0, sep);
    const dotpath = compositeKey.substring(sep + 2);

    if (!grouped.has(file)) {
      grouped.set(file, {});
    }
    grouped.get(file)![dotpath] = value;
  });

  return grouped;
}

async function main() {
  console.log('🔄 Unflattening translated files...\n');

  if (!fs.existsSync(TRANSLATION_DIR)) {
    console.error(`❌ Error: Translation directory not found: ${TRANSLATION_DIR}`);
    console.error('   Please run extract and translate steps first');
    process.exit(1);
  }

  const translationFiles = fs.readdirSync(TRANSLATION_DIR).filter((f) => f.endsWith('.json'));

  if (translationFiles.length === 0) {
    console.log('🎉 No translation files found. Nothing to unflatten.');
    return;
  }

  // Cache key orders per source file
  const keyOrders = new Map<string, string[]>();

  let totalFiles = 0;

  translationFiles.forEach((translationFile) => {
    const locale = translationFile.replace('.json', '');
    const filePath = path.join(TRANSLATION_DIR, translationFile);
    const grouped = parseIntermediateFile(filePath);

    grouped.forEach((flat, sourceFile) => {
      // Get key order from en source file (cached)
      if (!keyOrders.has(sourceFile)) {
        const enPath = path.join(MESSAGES_DIR, 'en', sourceFile);
        const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8')) as NestedObject;
        keyOrders.set(sourceFile, getKeyOrder(enJson));
      }

      const ordered = unflattenWithOrder(flat, keyOrders.get(sourceFile)!);
      const outputDir = path.join(FINAL_DIR, locale);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputPath = path.join(outputDir, sourceFile);
      fs.writeFileSync(outputPath, `${JSON.stringify(ordered, null, 2)}\n`);
      totalFiles++;
      console.log(`✅ final/${locale}/${sourceFile}: ${Object.keys(flat).length} keys`);
    });
  });

  console.log(`\n✅ Unflatten complete! ${totalFiles} files written to ${FINAL_DIR}`);
}

main().catch((error) => {
  console.error('\n❌ Unflatten failed:', error);
  process.exit(1);
});
