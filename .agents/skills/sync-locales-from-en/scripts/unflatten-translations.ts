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
  parseChunkFilename,
  type NestedObject,
} from './helpers';

const MESSAGES_DIR = MESSAGES_DIR_EXPORT;

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

  // Group chunk files by locale
  const localeChunks = new Map<string, string[]>();
  translationFiles.forEach((file) => {
    const parsed = parseChunkFilename(file);
    if (!parsed) return; // skip non-chunk files
    const { locale } = parsed;
    if (!localeChunks.has(locale)) {
      localeChunks.set(locale, []);
    }
    localeChunks.get(locale)!.push(file);
  });

  // Cache key orders per source file
  const keyOrders = new Map<string, string[]>();

  let totalFiles = 0;

  localeChunks.forEach((chunks, locale) => {
    // Merge all chunks into one flat object
    const mergedFlat: Record<string, string> = {};
    chunks.sort().forEach((chunkFile) => {
      const filePath = path.join(TRANSLATION_DIR, chunkFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const flat = JSON.parse(content) as Record<string, string>;
      Object.assign(mergedFlat, flat);
    });

    console.log(`📦 ${locale}: merged ${chunks.length} chunk(s), ${Object.keys(mergedFlat).length} keys`);

    // Parse merged flat into grouped-by-source-file structure
    const grouped = new Map<string, Record<string, string>>();
    Object.entries(mergedFlat).forEach(([compositeKey, value]) => {
      const sep = compositeKey.indexOf('::');
      if (sep === -1) return;
      const sourceFile = compositeKey.substring(0, sep);
      const dotpath = compositeKey.substring(sep + 2);
      if (!grouped.has(sourceFile)) {
        grouped.set(sourceFile, {});
      }
      grouped.get(sourceFile)![dotpath] = value;
    });

    grouped.forEach((flat, sourceFile) => {
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
